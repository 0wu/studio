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

import { useMessageReducer } from "@foxglove/studio-base/PanelAPI";
import { MessageEvent } from "@foxglove/studio-base/players/types";

import parseRosPath from "./parseRosPath";
import {
  useCachedGetMessagePathDataItems,
  MessageAndData,
} from "./useCachedGetMessagePathDataItems";

type Options = {
  historySize: number;
};

type ReducedValue = {
  matchedMessages: MessageAndData[];
  originalMessages: readonly Readonly<MessageEvent<unknown>>[];
};

/**
 * Return an array of MessageAndData[] for matching messages on @param path.
 *
 * The first array item is the oldest matched message, and the last item is the newest.
 *
 * The `historySize` option configures how many matching messages to keep. The default is 1.
 */
// fixme - rename
export function useLatestMessageDataItem(
  path: string,
  options?: Options,
): ReducedValue["matchedMessages"] {
  const { historySize = 1 } = options ?? {};
  const rosPath = useMemo(() => parseRosPath(path), [path]);
  const topics = useMemo(() => (rosPath ? [rosPath.topicName] : []), [rosPath]);

  const cachedGetMessagePathDataItems = useCachedGetMessagePathDataItems([path]);

  const addMessages = useCallback(
    (prevValue: ReducedValue, messageEvents: Readonly<MessageEvent<unknown>[]>): ReducedValue => {
      if (messageEvents.length === 0) {
        return prevValue;
      }

      const newMatches: MessageAndData[] = [];

      // Iterate backwards since our default history size is 1 and we might not need to visit all messages
      // This does mean we need to flip newMatches around since we want to store older items first
      for (let i = messageEvents.length - 1; i >= 0 && newMatches.length < historySize; --i) {
        const messageEvent = messageEvents[i]!;
        const queriedData = cachedGetMessagePathDataItems(path, messageEvent);
        if (queriedData && queriedData.length > 0) {
          newMatches.push({ messageEvent, queriedData });
        }
      }

      // We want older items to be first in the array. Since we iterated backwards
      // we reverse the matches.
      const reversed = newMatches.reverse();
      if (newMatches.length === historySize) {
        return {
          matchedMessages: reversed,
          originalMessages: messageEvents,
        };
      }

      const prevMatches = prevValue.matchedMessages;
      return {
        matchedMessages: prevMatches.concat(reversed).slice(-historySize),
        originalMessages: messageEvents,
      };
    },
    [cachedGetMessagePathDataItems, historySize, path],
  );

  const restore = useCallback(
    (prevValue?: ReducedValue): ReducedValue => {
      if (!prevValue) {
        return {
          matchedMessages: [],
          originalMessages: [],
        };
      }

      // re-filter the previous batch of messages
      const newMatches: MessageAndData[] = [];
      for (const messageEvent of prevValue.originalMessages) {
        const queriedData = cachedGetMessagePathDataItems(path, messageEvent);
        if (queriedData && queriedData.length > 0) {
          newMatches.push({ messageEvent, queriedData });
        }
      }

      if (newMatches.length > 0) {
        return {
          matchedMessages: newMatches.slice(-historySize),
          originalMessages: prevValue.originalMessages,
        };
      }

      return prevValue;
    },
    [cachedGetMessagePathDataItems, historySize, path],
  );

  const reducedValue = useMessageReducer<ReducedValue>({
    topics,
    addMessages,
    restore,
  });

  return reducedValue.matchedMessages;
}
