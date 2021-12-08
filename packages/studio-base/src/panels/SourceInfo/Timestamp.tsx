// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Stack, Icon, Text, useTheme } from "@fluentui/react";

import { Time } from "@foxglove/rostime";
import CopyText from "@foxglove/studio-base/components/CopyText";
import { formatDate, formatTime } from "@foxglove/studio-base/util/formatTime";
import { fonts } from "@foxglove/studio-base/util/sharedStyleConstants";
import { formatTimeRaw } from "@foxglove/studio-base/util/time";

type Props = {
  time: Time;
  timezone?: string;
};

export default function Timestamp({ time, timezone }: Props): JSX.Element {
  const theme = useTheme();
  const rawTime = formatTimeRaw(time);

  if (!isAbsoluteTime(time)) {
    return (
      <Stack horizontal verticalAlign="center" grow={0}>
        <Text
          variant="small"
          styles={{
            root: {
              fontFamily: fonts.MONOSPACE,
              color: theme.palette.neutralSecondary,
            },
          }}
        >
          {rawTime}
        </Text>
        <CopyText copyText={rawTime} tooltip="Copy time to clipboard">
          sec
        </CopyText>
      </Stack>
    );
  }

  const currentTimeStr = formatTime(time, timezone);
  const date = formatDate(time, timezone);

  return (
    <Stack tokens={{ childrenGap: theme.spacing.s2 }}>
      <Stack horizontal grow verticalAlign="center" tokens={{ childrenGap: theme.spacing.s2 }}>
        <Text
          variant="small"
          styles={{
            root: {
              fontFamily: fonts.MONOSPACE,
              color: theme.palette.neutralSecondary,
            },
          }}
        >
          {date}
        </Text>

        <Icon iconName="ChevronRight" styles={{ root: { opacity: 0.5 } }} />

        <Stack
          horizontal
          disableShrink
          verticalAlign="center"
          tokens={{ childrenGap: theme.spacing.s2 }}
        >
          <Text
            variant="small"
            styles={{
              root: {
                fontFamily: fonts.MONOSPACE,
                color: theme.palette.neutralSecondary,
              },
            }}
          >
            {currentTimeStr}
          </Text>
        </Stack>
      </Stack>
      <Stack horizontal verticalAlign="center">
        <CopyText copyText={rawTime} tooltip="Copy ROS time to clipboard">
          <Text
            variant="small"
            styles={{
              root: {
                fontFamily: fonts.MONOSPACE,
                color: theme.palette.neutralTertiary,
              },
            }}
          >
            {rawTime} ROS
          </Text>
        </CopyText>
      </Stack>
    </Stack>
  );
}

const DURATION_20_YEARS_SEC = 20 * 365 * 24 * 60 * 60;

// Values "too small" to be absolute epoch-based times are probably relative durations.
function isAbsoluteTime(time: Time): boolean {
  return time.sec > DURATION_20_YEARS_SEC;
}
