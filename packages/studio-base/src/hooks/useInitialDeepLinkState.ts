// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";

import Log from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useCurrentLayoutActions } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CurrentUserContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import { useToasts } from "react-toast-notifications";
import { PanelsState } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { useLayoutManager } from "@foxglove/studio-base/context/LayoutManagerContext";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";

const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

const log = Log.getLogger(__filename);

/**
 * Restores our session state from any deep link we were passed on startup.
 */
export function useInitialDeepLinkState(deepLinks: readonly string[]): {
  currentUserRequired: boolean;
} {
  const { selectSource } = usePlayerSelection();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const layoutManager = useLayoutManager();
  const { addToast } = useToasts();

  const seekPlayback = useMessagePipeline(selectSeek);
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const { currentUser } = useCurrentUser();

  const targetUrlState = useMemo(
    () => (deepLinks[0] ? parseAppURLState(new URL(deepLinks[0])) : undefined),
    [deepLinks],
  );

  // Maybe this should be abstracted somewhere but that would require a
  // more intimate interface with this hook and the player selection logic.
  const currentUserRequired = targetUrlState?.ds === "foxglove-data-platform";

  // Tracks what portions of the URL state we have yet to apply to the current session.
  const [unappliedUrlState, setUnappliedUrlState] = useState(
    targetUrlState ? { ...targetUrlState } : undefined,
  );

  const loadLayoutFromURL = useCallbackWithToast(async (layoutURL: URL) => {
    const url = new URL(layoutURL);

    const name = url.pathname.replace(/.*\//, '')
    log.debug(`Trying to load layout ${name} from ${url}`);
    let res;
    try {
      res = await fetch(url.href);
    } catch {
      addToast(`Could not load the layout from ${url}`, { appearance: "error" });
      return;
    }
    const parsedState: unknown = JSON.parse(await res.text());

    if (typeof parsedState !== "object" || !parsedState) {
      addToast(`${url} does not contain valid layout JSON`, { appearance: "error" });
      return;
    }

    const data = parsedState as PanelsState;
    const layouts = await layoutManager.getLayouts();
    const existing_layout = layouts.find(m => m.name == name);
    if (existing_layout)
    {
        layoutManager.updateLayout({
          id: existing_layout.id,
          data: data,
        })
        setSelectedLayoutId(existing_layout.id);  
    }
    else
    {
      const newLayout = await layoutManager.saveNewLayout({
        name,
        data,
        permission: "CREATOR_WRITE",
      });
      setSelectedLayoutId(newLayout.id);  
    }  
  
  }, [layoutManager, setSelectedLayoutId, addToast]);


  // Load data source from URL.
  useEffect(() => {
    if (!unappliedUrlState) {
      return;
    }

    // Wait for current user session if one is required for this source.
    if (currentUserRequired && !currentUser) {
      return;
    }

    // Apply any available datasource args
    if (unappliedUrlState.ds) {
      log.debug("Initialising source from url", unappliedUrlState);
      selectSource(unappliedUrlState.ds, {
        type: "connection",
        params: unappliedUrlState.dsParams,
      });
      setUnappliedUrlState((oldState) => ({ ...oldState, ds: undefined, dsParams: undefined }));
    }
  }, [currentUser, currentUserRequired, selectSource, unappliedUrlState]);

  // Select layout from URL.
  useEffect(() => {
    // layoutURL takes higher priority over layoutId
    if (unappliedUrlState?.layoutURL != undefined) {
      console.log("applying layoutURL", unappliedUrlState.layoutURL);
      void loadLayoutFromURL(unappliedUrlState.layoutURL);
      setUnappliedUrlState((oldState) => ({ ...oldState, layoutURL: undefined, layoutId: undefined }));
      setSelectedLayoutId(unappliedUrlState.layoutId);
      return;
    }

    if (!unappliedUrlState?.layoutId) {
      return;
    }

    // If our datasource requires a current user then wait until the player is
    // available to load the layout since we may need to sync layouts first and
    // that's only possible after the user has logged in.
    if (currentUserRequired && playerPresence !== PlayerPresence.PRESENT) {
      return;
    }

    log.debug(`Initializing layout from url: ${unappliedUrlState.layoutId}`);
    setSelectedLayoutId(unappliedUrlState.layoutId);
    setUnappliedUrlState((oldState) => ({ ...oldState, layoutId: undefined }));
  }, [currentUserRequired, playerPresence, setSelectedLayoutId, unappliedUrlState?.layoutId, unappliedUrlState?.layoutURL]);

  // Seek to time in URL.
  useEffect(() => {
    if (unappliedUrlState?.time == undefined || !seekPlayback) {
      return;
    }

    // Wait until player is ready before we try to seek.
    if (playerPresence !== PlayerPresence.PRESENT) {
      return;
    }

    log.debug(`Seeking to url time:`, unappliedUrlState.time);
    seekPlayback(unappliedUrlState.time);
    setUnappliedUrlState((oldState) => ({ ...oldState, time: undefined }));
  }, [playerPresence, seekPlayback, unappliedUrlState]);

  return useMemo(() => ({ currentUserRequired }), [currentUserRequired]);
}
