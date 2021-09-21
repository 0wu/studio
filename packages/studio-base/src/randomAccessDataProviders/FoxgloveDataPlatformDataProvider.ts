// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isEqual } from "lodash";
import decompressLZ4 from "wasm-lz4";

import Logger from "@foxglove/log";
import { ChannelInfo, McapReader, McapRecord, parseRecord } from "@foxglove/mcap";
import { parse as parseMessageDefinition, RosMsgDefinition } from "@foxglove/rosmsg";
import { LazyMessageReader } from "@foxglove/rosmsg-serialization";
import { MessageReader as ROS2MessageReader } from "@foxglove/rosmsg2-serialization";
import { Time, isTimeInRangeInclusive, fromDate, subtract } from "@foxglove/rostime";
import {
  MessageDefinitionsByTopic,
  MessageEvent,
  ParsedMessageDefinitionsByTopic,
  Topic,
} from "@foxglove/studio-base/players/types";
import {
  RandomAccessDataProvider,
  RandomAccessDataProviderDescriptor,
  ExtensionPoint,
  GetMessagesResult,
  GetMessagesTopics,
  InitializationResult,
  Connection,
} from "@foxglove/studio-base/randomAccessDataProviders/types";
import ConsoleApi from "@foxglove/studio-base/services/ConsoleApi";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

const log = Logger.getLogger(__filename);

type Options = { consoleApi: ConsoleApi; deviceId: string; start: string; end: string };

export default class FoxgloveDataPlatformDataProvider implements RandomAccessDataProvider {
  private extensionPoint?: ExtensionPoint;

  constructor(private options: Options, children: RandomAccessDataProviderDescriptor[]) {
    if (children.length > 0) {
      throw new Error("FoxgloveDataPlatformDataProvider cannot have children");
    }
  }

  async initialize(extensionPoint: ExtensionPoint): Promise<InitializationResult> {
    this.extensionPoint = extensionPoint;
    await decompressLZ4.isLoaded;

    const startTime = fromDate(new Date(this.options.start));
    const endTime = fromDate(new Date(this.options.end));

    const rawTopics = await this.options.consoleApi.topics({
      deviceId: this.options.deviceId,
      start: this.options.start,
      end: this.options.end,
      includeSchemas: true,
    });

    const topics: Topic[] = [];
    const connections: Connection[] = [];
    const datatypes: RosDatatypes = new Map([["TODO", { definitions: [] }]]);
    const messageDefinitionsByTopic: MessageDefinitionsByTopic = {};
    const parsedMessageDefinitionsByTopic: ParsedMessageDefinitionsByTopic = {};

    for (const { topic, version, serializationFormat, schema } of rawTopics) {
      const datatypeName = version; //FIXME
      if (schema == undefined) {
        throw new Error(`missing requested schema for ${topic}`);
      }
      topics.push({
        name: topic,
        datatype: datatypeName,
      });
      const parsedDefinitions = parseMessageDefinition(schema, { ros2: false /*FIXME*/ });
      parsedDefinitions.forEach(({ name, definitions }, index) => {
        // The first definition usually doesn't have an explicit name,
        // so we get the name from the datatype.
        if (index === 0) {
          datatypes.set(datatypeName, { name: datatypeName, definitions });
        } else if (name != undefined) {
          datatypes.set(name, { name, definitions });
        }
      });
    }

    // for (const { info, parsedDefinitions } of channelInfoById.values()) {
    //   topics.push({
    //     name: info.topic,
    //     datatype: "TODO", //FIXME
    //   });
    //   const messageDefinition = new TextDecoder().decode(info.schema);
    //   connections.push({
    //     topic: info.topic,
    //     messageDefinition,
    //     md5sum: "",
    //     type: "",
    //     callerid: "",
    //   });
    //   // datatypes.set(topicDef.type, { name: topicDef.type, definitions: parsedMsgdef.definitions });
    //   messageDefinitionsByTopic[info.topic] = messageDefinition;
    //   parsedMessageDefinitionsByTopic[info.topic] = parsedDefinitions;
    // }

    console.log("got topics", rawTopics);

    return {
      start: startTime,
      end: endTime,
      topics,
      connections,
      providesParsedMessages: true,
      messageDefinitions: {
        type: "parsed",
        datatypes,
        messageDefinitionsByTopic,
        parsedMessageDefinitionsByTopic,
      },
      problems: [],
    };
  }

  async getMessages(
    requestedStart: Time,
    requestedEnd: Time,
    subscriptions: GetMessagesTopics,
  ): Promise<GetMessagesResult> {
    log.debug("getMessages duration:", subtract(requestedEnd, requestedStart));
    const topics = subscriptions.parsedMessages;
    if (topics == undefined) {
      return {};
    }

    const startTimer = performance.now();
    const { link: mcapUrl } = await this.options.consoleApi.stream({
      deviceId: this.options.deviceId,
      start: new Date(
        Math.floor(requestedStart.sec * 1000 + requestedStart.nsec / 1e6),
      ).toISOString(),
      end: new Date(Math.ceil(requestedEnd.sec * 1000 + requestedEnd.nsec / 1e6)).toISOString(),
      topics,
    });
    const response = await fetch(mcapUrl);
    if (!response.body) {
      throw new Error("Unable to stream response body");
    }
    const streamReader = response.body?.getReader();

    const channelInfoById = new Map<
      number,
      {
        info: ChannelInfo;
        messageDeserializer: ROS2MessageReader | LazyMessageReader;
        parsedDefinitions: RosMsgDefinition[];
      }
    >();

    const reader = new McapReader();
    const messages: MessageEvent<unknown>[] = [];
    let readHeader = false;
    let readFooter = false;
    function processRecord(record: McapRecord) {
      switch (record.type) {
        case "ChannelInfo": {
          const existingInfo = channelInfoById.get(record.id);
          if (existingInfo) {
            if (!isEqual(existingInfo.info, record)) {
              throw new Error(`differing channel infos for for ${record.id}`);
            }
            break;
          }
          let parsedDefinitions;
          let messageDeserializer;
          if (record.schemaFormat === "ros1") {
            parsedDefinitions = parseMessageDefinition(new TextDecoder().decode(record.schema));
            messageDeserializer = new LazyMessageReader(parsedDefinitions);
          } else if (record.schemaFormat === "ros2") {
            parsedDefinitions = parseMessageDefinition(new TextDecoder().decode(record.schema), {
              ros2: true,
            });
            messageDeserializer = new ROS2MessageReader(parsedDefinitions);
          } else {
            throw new Error(`unsupported schema format ${record.schemaFormat}`);
          }
          channelInfoById.set(record.id, { info: record, messageDeserializer, parsedDefinitions });
          break;
        }

        case "Message": {
          const channelInfo = channelInfoById.get(record.channelId);
          if (!channelInfo) {
            throw new Error(`message for channel ${record.channelId} with no prior channel info`);
          }
          const receiveTime = {
            sec: Number(record.timestamp / 1_000_000_000n),
            nsec: Number(record.timestamp % 1_000_000_000n),
          };
          if (isTimeInRangeInclusive(receiveTime, requestedStart, requestedEnd)) {
            messages.push({
              topic: channelInfo.info.topic,
              receiveTime,
              message: channelInfo.messageDeserializer.readMessage(new Uint8Array(record.data)),
            });
          }
          break;
        }
        case "Chunk": {
          let buffer = new Uint8Array(record.data);
          if (record.compression === "lz4") {
            buffer = decompressLZ4(buffer, Number(record.decompressedSize));
            //FIXME: check crc32
          }
          let offset = 0;
          const view = new DataView(buffer.buffer);
          for (
            let subRecord, usedBytes;
            ({ record: subRecord, usedBytes } = parseRecord(view, offset)), subRecord;

          ) {
            processRecord(subRecord);
            offset += usedBytes;
          }
          break;
        }
        case "IndexData":
          throw new Error("not yet implemented");
        case "ChunkInfo":
          throw new Error("not yet implemented");
        case "Footer":
          throw new Error("unexpected footer record");
      }
    }
    for (let result; (result = await streamReader.read()), !result.done; ) {
      if (readFooter) {
        throw new Error("already read footer");
      }
      reader.append(result.value);
      if (!readHeader) {
        const magic = reader.readMagic();
        if (magic) {
          if (magic.formatVersion !== 1) {
            throw new Error("unsupported format version");
          }
          readHeader = true;
        }
      }
      for (let record; (record = reader.readRecord()); ) {
        if (record.type === "Footer") {
          const magic = reader.readMagic();
          if (!magic) {
            throw new Error("missing trailing magic after footer record");
          }
          if (magic.formatVersion !== 1) {
            throw new Error("unsupported format version");
          }
          readFooter = true;
          break;
        } else {
          processRecord(record);
        }
      }
    }
    if (!readFooter) {
      throw new Error("missing footer in mcap file");
    }

    log.debug(
      "Received",
      messages.length,
      "messages",
      messages,
      "in",
      `${performance.now() - startTimer}ms`,
    );

    return { parsedMessages: messages };
  }

  async close(): Promise<void> {
    // no-op
  }
}
