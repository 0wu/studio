// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { useCallback, useMemo } from "react";

import * as PanelAPI from "@foxglove/studio-base/PanelAPI";
import { MessageEvent } from "@foxglove/studio-base/players/types";

import parseRosPath from "./parseRosPath";
import {
  useCachedGetMessagePathDataItems,
  MessageAndData,
} from "./useCachedGetMessagePathDataItems";

type Options = {
  historySize: number;
};

type ReducedValue = MessageAndData[];

/**
 * Return an array of MessageAndData[] for matching messages on @param path.
 *
 * The first array item is the oldest matched message, and the last item is the newest.
 *
 * The `historySize` option configures how many matching messages to keep. The default is 1.
 */
// fixme - rename
export function useLatestMessageDataItem(path: string, options?: Options): ReducedValue {
  const { historySize = 1 } = options ?? {};
  const rosPath = useMemo(() => parseRosPath(path), [path]);
  const topics = useMemo(() => (rosPath ? [rosPath.topicName] : []), [rosPath]);

  const cachedGetMessagePathDataItems = useCachedGetMessagePathDataItems([path]);

  const addMessages = useCallback(
    (prevValue: ReducedValue, messages: Readonly<MessageEvent<unknown>[]>): ReducedValue => {
      // New matches are collected here and
      const newMatches: ReducedValue = [];

      // Iterate in reverse so we can early-return and not process all messages.
      // We stop once we've got historySize messages matched
      for (let i = messages.length - 1; i >= 0 && newMatches.length < historySize; --i) {
        const message = messages[i]!;
        const queriedData = cachedGetMessagePathDataItems(path, message);
        if (queriedData == undefined || queriedData.length === 0) {
          continue;
        }

        newMatches.push({ messageEvent: message, queriedData });
      }

      if (newMatches.length === 0) {
        return prevValue;
      }

      // Older messages need to be at the front
      const reversed = newMatches.reverse();

      // When the length is exactly the history size
      if (newMatches.length === historySize) {
        return reversed;
      }

      return prevValue.concat(reversed).slice(-historySize);
    },
    [cachedGetMessagePathDataItems, historySize, path],
  );

  const restore = useCallback(
    (prevValue?: ReducedValue): ReducedValue => {
      if (!prevValue) {
        return [];
      }

      // re-test all the previous messages to make sure they still match
      return prevValue.filter((messageAndData) => {
        const queriedData = cachedGetMessagePathDataItems(path, messageAndData.messageEvent);
        return queriedData && queriedData.length > 0;
      });
    },
    [cachedGetMessagePathDataItems, path],
  );

  const matchedMessages = PanelAPI.useMessageReducer<ReducedValue>({
    topics,
    addMessages,
    restore,
  });

  return useMemo(() => {
    if (!rosPath) {
      return [];
    }

    return matchedMessages;
  }, [matchedMessages, rosPath]);
}
