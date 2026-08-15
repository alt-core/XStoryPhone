<script lang="ts">
  import { onMount } from "svelte";
  import ProjectStage from "../project/ProjectStage.svelte";
  import type { PhonePresentation, ProjectStageContext } from "../project/projectStage";
  import CalendarApp from "./apps/CalendarApp.svelte";
  import ChatApp from "./apps/ChatApp.svelte";
  import MessagesApp from "./apps/MessagesApp.svelte";
  import NotesApp from "./apps/NotesApp.svelte";
  import PhoneApp from "./apps/PhoneApp.svelte";
  import RadioApp from "./apps/RadioApp.svelte";
  import AlbumApp from "./apps/PhotosApp.svelte";
  import { clearTalkDelaySeenMessagesForMemoryKey } from "./apps/talkDelaySeenStorage";
  import { demoDeviceStateGenerated as demoDeviceState } from "./generated/demoDeviceState.generated";
  import { demoProjectConstantsGenerated as projectConstants } from "./generated/demoProjectConstants.generated";
  import type {
    AppId,
    AssistantMessage,
    CalendarEvent,
    ChatAppMessage,
    ChatAppThread,
    SearchAgentSearchResponse,
    SearchAgentSearchResult,
    DeviceState,
    IncomingCallItem,
    LockedAttachment,
    Message,
    MessageAttachment,
    MessageThread,
    NotificationItem,
    NoteItem,
    PendingShareDraft,
    PhotoItem,
    RadioEpisodeItem,
    ScenarioContentMeta,
    TalkShareTarget
  } from "./scenario-runtime/types";
  import { trackClientError, trackEvent } from "./system/analytics";
  import { createAppCatalog, type AppCatalogItem } from "./system/appCatalog";
  import { safeLocalStorage, safeSessionStorage } from "./system/browserStorage";
  import {
    goBackInPhoneHistory,
    phoneHistoryStateFrom,
    pushPhoneHistoryRoute,
    replacePhoneHistoryRoute,
    type PhoneHistoryRoute
  } from "./system/phoneHistory";
  import { localPlayerMemoryKey, playerSessionChanged } from "./system/playerSession";
  import { clearSearchAgentLocalMessages } from "./system/searchAgentStorage";
  import AllClearOverlay from "./system/AllClearOverlay.svelte";
  import GameOverOverlay from "./system/GameOverOverlay.svelte";
  import HomeScreen from "./system/HomeScreen.svelte";
  import LockScreen from "./system/LockScreen.svelte";
  import NoiseOverlay from "./system/NoiseOverlay.svelte";
  import NotificationShade from "./system/NotificationShade.svelte";
  import NotificationToast from "./system/NotificationToast.svelte";
  import PhoneFrame from "./system/PhoneFrame.svelte";
  import PhoneStage from "./system/PhoneStage.svelte";
  import GlobalErrorScreen from "./system/GlobalErrorScreen.svelte";
  import StartConfirmationScreen from "./system/StartConfirmationScreen.svelte";
  import {
    ALBUM_MEDIA_ADDED_ASSISTANT_BODY,
    albumMediaAddedAssistantKey,
    assistantHiddenByComposerPhotoDraft,
    clearAlbumAssistantStateForPhotoDraft
  } from "./system/albumAssistantUiState";
  import {
    searchAgentSearch,
    clearTranscriptStorage,
    loadBrowserProgressToken,
    loadPlayerState,
    recordContentMediaObserved,
    recordContentOpened,
    recordScenarioEvent,
    resetPlayerState,
    sendTalkMessage,
    submitRadioForm,
    startSession,
    unlockContent,
    openMessageLink,
    playerMode,
    type AllClearPayload,
    type GameOverPayload,
    type GameOverTalkMessage,
    type PlayerState,
    type TalkReadCursorPayload
  } from "./system/playerApi";
  import {
    installAudioUnlockListeners,
    playAudio,
    preloadAudioSegments,
    stopAudioPlayback,
    type AudioPlaybackCue,
    type AudioPlaybackSegment
  } from "./system/audioEngine";
  import {
    defaultUiState,
    clearStartConfirmation,
    hasStartConfirmation,
    loadUiState,
    saveStartConfirmation,
    saveUiState,
    type PersistedUiState
  } from "./system/progress";

  const pinLength = import.meta.env.DEV || import.meta.env.VITE_XSTORYPHONE_DEV_PIN === "true" ? 4 : 8;
  const queryParams = new URLSearchParams(window.location.search);
  const holdScreenEnabled = import.meta.env.VITE_XSTORYPHONE_HOLD_SCREEN === "true";
  const holdScreenBypassed = queryParams.has("force");
  const qaMode = (import.meta.env.DEV || import.meta.env.VITE_XSTORYPHONE_QA_MODE === "true") && queryParams.get("qa") === "all";
  const localQaMode = qaMode;
  const qaAppId = appIdFromQuery(queryParams.get("app"));
  const qaView = queryParams.get("view") ?? "";
  const qaFocusContentId = queryParams.get("focus") ?? "";
  const qaGeneratedAudioReady = queryParams.get("ai") !== "form";
  const qaRadioPlaybackBlocked = queryParams.get("playback") === "blocked";
  const qaRadioFormDisabled = queryParams.get("form") === "disabled";
  const PLAYER_STATE_CACHE_KEY = "xstoryphone.player-state-cache";
  const PLAYER_STATE_CACHE_VERSION = 11;
  const CLIENT_RUNTIME_REVISION = String(projectConstants["client.runtime_revision"] ?? "");
  const FORCE_RELOAD_STORAGE_KEY = "xstoryphone.force-reload-revision";
  const RESET_FOR_TESTING_PATH_SUFFIX = "/reset-for-testing";
  const LOGOUT_PATH_SUFFIX = "/logout";
  const resetForTestingEnabled = import.meta.env.DEV || import.meta.env.VITE_XSTORYPHONE_RESET_FOR_TESTING === "true";
  const PLAYER_STATE_HOME_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
  const SCENARIO_WAKE_TIMER_MAX_MS = 2_147_483_647;
  const PROGRESSION_RETRY_DELAYS_MS = [1_000, 3_000] as const;
  const incomingCallBellAudioUrl = "/system/incoming-call-bell.wav";
  const photoMessagePattern = /^photo:([a-zA-Z0-9_:-]+)$/;
  const shareMessagePattern = /^share:([a-zA-Z0-9_:-]+)$/;
  const GAME_OVER_OVERLAY_MIN_DELAY_MS = 1400;
  const GAME_OVER_OVERLAY_PADDING_MS = 900;
  const GAME_OVER_OVERLAY_MAX_DELAY_MS = 9000;
  const GAME_OVER_RETURN_BLACKOUT_MIN_MS = 240;
  const ALL_CLEAR_RETURN_WHITEOUT_MIN_MS = 280;
  const ALL_CLEAR_LABEL = "そして、数時間後……";
  const RADIO_PLAYBACK_PROGRESS_INTERVAL_MS = 250;
  const INITIAL_MESSAGE_LINK_TUTORIAL_BODY = projectConstants["searchAgent.broken_link_tutorial_body"];
  const BROKEN_LINK_ASSISTANT_BODY = projectConstants["searchAgent.broken_link_body"];
  const TALK_INITIAL_DATE_LABEL = compactDateLabel(projectConstants["device.date_label"]);
  type SurfaceMessageMode = "search" | "dismissOnTap";
  type TalkKind = "sms" | "chat";
  type ReplyDelayAnchor = {
    waiting: boolean;
  };
  type DisplayedTalkTarget = {
    appId: "messages" | "chat";
    contentId: string;
  };
  type TalkBackLinkAppId = DisplayedTalkTarget["appId"];
  type TemporaryTalkBackLink = {
    sourceAppId: TalkBackLinkAppId;
    targetAppId: AppId;
  };
  type RadioPlaybackState = {
    itemId: string;
    contentId: string;
    audioKey: string;
    currentMs: number;
    durationMs: number;
    active: boolean;
    requestId: number;
  };
  type RadioPlaybackStartRequest = {
    item: RadioEpisodeItem;
    audioKey: string;
    segments: AudioPlaybackSegment[];
    cues: AudioPlaybackCue[];
  };
  const TALK_BACK_LINK_LABELS: Record<TalkBackLinkAppId, string> = {
    messages: "メッセージ",
    chat: "チャット"
  };

  const persistedUiState = loadUiState();
  const browserProgressToken = loadBrowserProgressToken();
  let uiState: PersistedUiState = localQaMode
    ? {
        ...defaultUiState,
        locked: qaView === "lock",
        sessionToken: "qa-display-check",
        serialCounter: "qa"
      }
    : {
        ...persistedUiState,
        ...(browserProgressToken ? { sessionToken: browserProgressToken } : {})
      };
  let playerState: PlayerState | null = localQaMode ? null : loadCachedPlayerState(uiState.sessionToken, uiState.locked);
  let deviceState: DeviceState = demoDeviceState;
  let activeAppId: AppId | null = qaMode && !uiState.locked && qaView !== "incoming" ? qaAppId : null;
  let shadeOpen = qaMode && qaView === "shade";
  let noiseVisible = false;
  let noiseTimer: number | undefined;
  let incomingCall: IncomingCallItem | undefined;
  let locallyCompletedIncomingCallIds: string[] = [];
  let interruptedIncomingCallId = "";
  let selectedAssistantSurface = "";
  let selectedAssistantRevision = "";
  let selectedAssistantMessage: AssistantMessage | undefined;
  let transientAssistantMessage: AssistantMessage | undefined;
  let brokenLinkAssistantSerial = 0;
  let albumMediaAddedAssistantSerial = 0;
  let pendingAlbumMediaAddedAssistantKeys: string[] = [];
  let focusedContentId = qaMode ? qaFocusContentId : "";
  let focusedContentRequestId = 0;
  let pendingNotificationOpen: { appId: AppId; contentId: string } | null = null;
  let inFlightContentOpenKeys: string[] = [];
  let inFlightMediaObservedKeys: string[] = [];
  let suppressedContentOpenKeys: string[] = [];
  let appModalOpen = false;
  let composerPhotoDraftByApp: Partial<Record<AppId, boolean>> = {};
  let displayedTalkTarget: DisplayedTalkTarget | null = null;
  let temporaryTalkBackLink: TemporaryTalkBackLink | null = null;
  let locallySuppressedNotificationIds: string[] = [];
  let seenNotificationIds: string[] = [];
  let notificationTrackingInitialized = false;
  let notificationToast: NotificationItem | null = null;
  let notificationToastTimer: number | undefined;
  let temporaryTalkMessages: GameOverTalkMessage[] = [];
  let pendingTalkMessages: GameOverTalkMessage[] = [];
  let replyDelayAnchorsByThread: Record<string, ReplyDelayAnchor> = {};
  let pendingTalkMessageCounter = 0;
  let lastPlayerStateRefreshRequestedAt = 0;
  let scenarioWakeTimer: number | undefined;
  let scenarioWakeTimerKey = "";
  let gameOverVisible = qaMode && qaView === "game-over";
  let gameOverReturning = false;
  let gameOverTalk: { talkId: string; kind: "sms" | "chat" } | null = null;
  let gameOverReasonMessage = gameOverVisible ? queryParams.get("reason") ?? "" : "";
  let gameOverOverlayTimer: number | undefined;
  let allClearVisible = qaMode && qaView === "all-clear";
  let allClearReturning = false;
  let allClearTarget: AllClearPayload["target"] | null = null;
  let allClearAutoplay = allClearVisible;
  let allClearOverlayTimer: number | undefined;
  let radioAutoplayContentId = "";
  let radioAutoplayRequestId = 0;
  let radioPlaybackFocusRequestId = 0;
  let radioPlayback: RadioPlaybackState = emptyRadioPlaybackState();
  let radioPlaybackLoadingItemId = "";
  let radioPlaybackSerial = 0;
  let lastRadioPlaybackProgressAt = 0;
  let pendingShareDraft: PendingShareDraft | null = null;
  let shareDraftRequestId = 0;
  let phoneHistoryScope = crypto.randomUUID();
  let phoneHistoryReady = false;
  let phoneHistoryNavigationId = 0;
  let startConfirmationDone = localQaMode || hasStartConfirmation();
  let globalErrorVisible = false;
  let globalErrorMessage = "";
  let globalErrorSupportCode = "AP-CLIENT";
  let projectStageContext: ProjectStageContext;

  $: holdScreenRequired = !localQaMode && holdScreenEnabled && !holdScreenBypassed;
  $: startConfirmationRequired = !localQaMode && !holdScreenRequired && !startConfirmationDone;
  $: outOfGameVisible = globalErrorVisible || holdScreenRequired || startConfirmationRequired;
  $: projectStageContext = {
    sessionToken: uiState.sessionToken ?? "",
    playerState,
    projectState: playerState?.projectState ?? {},
    dispatchScenarioEvent: dispatchProjectScenarioEvent
  };
  $: if (displayedTalkTarget && activeAppId !== displayedTalkTarget.appId) {
    displayedTalkTarget = null;
  }
  $: syncDisplayedTalkNotificationSuppression(playerState?.visibleDeviceState.notifications ?? [], displayedTalkTarget);
  $: deviceState = applyLocalTalkReadCursors(
    mergePlayerState(
      demoDeviceState,
      playerState,
      pendingTalkMessages,
      temporaryTalkMessages,
      displayedTalkTarget,
      locallySuppressedNotificationIds
    ),
    uiState.localTalkReadCursors
  );
  $: apps = createAppCatalog(deviceState.apps);
  $: unreadAppIds = unreadAppIdsForDeviceState(deviceState);
  $: activeApp = activeAppId ? apps.find((app) => app.id === activeAppId && app.available) : null;
  $: if (activeAppId !== "messages" && activeAppId !== "chat" && activeAppId !== "radio" && appModalOpen) {
    appModalOpen = false;
  }
  $: stateIncomingCall = deviceState.incomingCall && !locallyCompletedIncomingCallIds.includes(deviceState.incomingCall.id)
    ? deviceState.incomingCall
    : undefined;
  $: activeIncomingCall = incomingCall ?? stateIncomingCall;
  $: if (activeIncomingCall?.id && activeIncomingCall.id !== interruptedIncomingCallId) {
    interruptedIncomingCallId = activeIncomingCall.id;
    stopBackgroundMediaPlayback();
  } else if (!activeIncomingCall && interruptedIncomingCallId) {
    interruptedIncomingCallId = "";
  }
  $: routeKey = holdScreenRequired ? "hold-screen" : startConfirmationRequired ? "start-confirmation" : uiState.locked ? "lock" : activeApp?.id ?? "home";
  $: visibleTalkBackLink =
    temporaryTalkBackLink && activeApp?.id === temporaryTalkBackLink.targetAppId && !shadeOpen && !uiState.locked
      ? temporaryTalkBackLink
      : null;
  $: if (temporaryTalkBackLink && activeApp?.id !== temporaryTalkBackLink.targetAppId) {
    temporaryTalkBackLink = null;
  }
  $: assistantSurfaceKey = activeApp?.id ?? "home";
  $: updateSelectedAssistantMessage(assistantSurfaceKey, playerState?.revision ?? deviceState.revision, playerState?.assistantMessages ?? []);
  $: rawAssistantSurfaceMessage = transientAssistantMessage ?? selectedAssistantMessage;
  $: assistantSurfaceMessage = visibleSurfaceMessageFor(rawAssistantSurfaceMessage, activeAppId, shadeOpen);
  $: assistantSurfaceMessageMode = surfaceMessageModeFor(assistantSurfaceMessage, activeAppId, shadeOpen);
  $: updateNotificationToast(deviceState.notifications);
  $: syncScenarioWakeTimer(playerState?.nextScenarioWakeAt ?? null, uiState.sessionToken, uiState.locked, outOfGameVisible);

  onMount(() => {
    initializePhoneHistory();
    const removeAudioUnlockListeners = installAudioUnlockListeners();
    const handleWindowError = (event: ErrorEvent) => {
      if (isAudioCleanupError(event.error ?? event.message)) {
        event.preventDefault();
        console.warn("[audio:cleanup]", event.error ?? event.message);
        return;
      }

      trackClientError({
        kind: "window_error",
        reason: event.error ?? event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
      showGlobalError(event.error ?? event.message, {
        supportCode: "AP-CLIENT"
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isAudioCleanupError(event.reason)) {
        event.preventDefault();
        console.warn("[audio:cleanup]", event.reason);
        return;
      }

      trackClientError({
        kind: "unhandled_rejection",
        reason: event.reason
      });
      showGlobalError(event.reason, {
        supportCode: "AP-PROMISE"
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("popstate", handlePhoneHistoryPop);

    if (qaMode) {
      void loadQaPlayerState();
    } else if (shouldLogoutFromUrl()) {
      logoutPlayerFromUrl();
    } else if (shouldResetPlayerStateFromUrl()) {
      void resetPlayerStateFromUrl();
    } else if (holdScreenRequired) {
      clearScenarioWakeTimer();
    } else if (!startConfirmationRequired && uiState.sessionToken && !uiState.locked) {
      void refreshPlayerStateWithRetry(uiState.sessionToken, "AP-STATE");
    }

    window.addEventListener("xstoryphone:incoming-call", handleIncomingCallEvent as EventListener);
    window.addEventListener("xstoryphone:audio-playback-complete", handleAudioPlaybackComplete as EventListener);
    window.addEventListener("xstoryphone:audio-cue-reached", handleAudioCueReached as EventListener);
    void preloadAudioSegments([{ url: incomingCallBellAudioUrl }]).catch(() => undefined);

    return () => {
      removeAudioUnlockListeners();
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("popstate", handlePhoneHistoryPop);
      window.removeEventListener("xstoryphone:incoming-call", handleIncomingCallEvent as EventListener);
      window.removeEventListener("xstoryphone:audio-playback-complete", handleAudioPlaybackComplete as EventListener);
      window.removeEventListener("xstoryphone:audio-cue-reached", handleAudioCueReached as EventListener);
      clearScenarioWakeTimer();
    };
  });

  function isAudioCleanupError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
    // 着信ベルが loop した瞬間に Safari + Howler の後片付けで起きる既知問題の暫定回避。
    // 本来は audioEngine / Howler 側の loop 終了処理として根本修正する。
    return message.includes("removeEventListener");
  }

  function showGlobalError(
    reason: unknown,
    options: { message?: string; supportCode?: string } = {}
  ) {
    console.error("XStoryPhone のグローバルエラーです。", reason);
    try {
      stopBackgroundMediaPlayback();
    } catch (error) {
      console.warn("[global-error:media-stop]", error);
    }
    globalErrorMessage = options.message ?? "";
    globalErrorSupportCode = options.supportCode ?? "AP-CLIENT";
    globalErrorVisible = true;
    resetPhoneHistoryBoundary();
  }

  function emptyRadioPlaybackState(requestId = 0): RadioPlaybackState {
    return {
      itemId: "",
      contentId: "",
      audioKey: "",
      currentMs: 0,
      durationMs: 0,
      active: false,
      requestId
    };
  }

  function loadCachedPlayerState(sessionToken: string | undefined, locked: boolean): PlayerState | null {
    if (!sessionToken || locked) {
      return null;
    }

    const rawValue = safeLocalStorage.getItem(PLAYER_STATE_CACHE_KEY);
    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as { version?: unknown; sessionToken?: unknown; playerState?: PlayerState };
      if (parsed.version !== PLAYER_STATE_CACHE_VERSION || parsed.sessionToken !== sessionToken) {
        clearPlayerStateCache();
        return null;
      }

      if (
        CLIENT_RUNTIME_REVISION &&
        typeof parsed.playerState?.clientRevision === "string" &&
        parsed.playerState.clientRevision !== CLIENT_RUNTIME_REVISION
      ) {
        clearPlayerStateCache();
        return null;
      }

      return typeof parsed.playerState?.stateVersion === "number" ? parsed.playerState : null;
    } catch {
      clearPlayerStateCache();
      return null;
    }
  }

  function cachePlayerState(state: PlayerState) {
    if (localQaMode || !uiState.sessionToken || uiState.locked) {
      return;
    }

    safeLocalStorage.setItem(
      PLAYER_STATE_CACHE_KEY,
      JSON.stringify({
        version: PLAYER_STATE_CACHE_VERSION,
        sessionToken: uiState.sessionToken,
        playerState: state
      })
    );
  }

  function clearPlayerStateCache() {
    safeLocalStorage.removeItem(PLAYER_STATE_CACHE_KEY);
  }

  function forceReloadForClientRevision(serverRevision: string) {
    clearPlayerStateCache();
    const reloadKey = `${CLIENT_RUNTIME_REVISION || "unknown"}:${serverRevision || "unknown"}`;
    if (safeSessionStorage.getItem(FORCE_RELOAD_STORAGE_KEY) === reloadKey) {
      showGlobalError("client_revision_reload_failed", {
        supportCode: "AP-UPDATE"
      });
      return;
    }
    if (!safeSessionStorage.setItem(FORCE_RELOAD_STORAGE_KEY, reloadKey)) {
      showGlobalError("client_revision_storage_unavailable", {
        supportCode: "AP-UPDATE"
      });
      return;
    }
    window.location.reload();
  }

  function applyPlayerState(state: PlayerState, options: { force?: boolean } = {}) {
    if (!localQaMode && CLIENT_RUNTIME_REVISION && state.clientRevision && state.clientRevision !== CLIENT_RUNTIME_REVISION) {
      forceReloadForClientRevision(state.clientRevision);
      return false;
    }
    safeSessionStorage.removeItem(FORCE_RELOAD_STORAGE_KEY);

    if (!options.force && playerState && state.stateVersion < playerState.stateVersion) {
      return false;
    }

    if (!options.force && playerState && state.stateVersion === playerState.stateVersion && state.revision !== playerState.revision) {
      return false;
    }

    if (playerMode === "browser" && state.progressToken && state.progressToken !== uiState.sessionToken) {
      persist({ sessionToken: state.progressToken });
    }
    playerState = state;
    cachePlayerState(state);
    return true;
  }

  function applyErrorPlayerState(result: { ok: false; error: string; playerState?: PlayerState }) {
    showBrowserProgressSizeError(result.error);
    if (result.playerState) {
      applyPlayerState(result.playerState);
    }
  }

  function showBrowserProgressSizeError(error: string | undefined) {
    if (error !== "browser_progress_too_large") {
      return false;
    }
    showGlobalError(error, { supportCode: "AP-PROGRESS-SIZE" });
    return true;
  }

  async function loadQaPlayerState() {
    const { createQaIncomingCall, createQaPlayerState } = await import("./scenario-runtime/demoQaDisplayState");
    const qaState = createQaPlayerState({
      generatedAudioReady: qaGeneratedAudioReady,
      radioPlaybackBlocked: qaRadioPlaybackBlocked,
      radioFormDisabled: qaRadioFormDisabled
    });
    applyPlayerState(qaState, { force: true });
    if (qaView === "all-clear") {
      const targetItem = qaState.visibleDeviceState.radioItems?.find((item) => item.form);
      allClearTarget = targetItem ? { appId: "radio", contentId: targetItem.id } : null;
    }
    if (qaView === "incoming") {
      incomingCall = createQaIncomingCall();
    }
  }

  function updateSelectedAssistantMessage(surface: string, revision: string, messages: AssistantMessage[]) {
    if (surface === selectedAssistantSurface && revision === selectedAssistantRevision) {
      return;
    }

    selectedAssistantSurface = surface;
    selectedAssistantRevision = revision;
    selectedAssistantMessage = chooseWeightedAssistantMessage(messages.filter((message) => message.surface === surface));
  }

  function updateNotificationToast(notifications: NotificationItem[]) {
    const currentIds = notifications.map((notification) => notification.id);
    if (!notificationTrackingInitialized) {
      notificationTrackingInitialized = true;
      seenNotificationIds = currentIds;
      return;
    }

    const newNotification = notifications.find((notification) => !seenNotificationIds.includes(notification.id));
    seenNotificationIds = currentIds;
    if (!newNotification) {
      return;
    }

    notificationToast = newNotification;
    window.clearTimeout(notificationToastTimer);
    notificationToastTimer = window.setTimeout(() => {
      if (notificationToast?.id === newNotification.id) {
        notificationToast = null;
      }
    }, 4200);
  }

  function chooseWeightedAssistantMessage(messages: AssistantMessage[]) {
    if (!messages.length) {
      return undefined;
    }

    const totalWeight = messages.reduce((sum, message) => sum + Math.max(0, message.weight || 1), 0);
    let cursor = Math.random() * (totalWeight || messages.length);

    for (const message of messages) {
      cursor -= Math.max(0, message.weight || 1);
      if (cursor <= 0) {
        return message;
      }
    }

    return messages[messages.length - 1];
  }

  function isInitialMessageLinkTutorial(message: AssistantMessage | undefined, currentAppId: AppId | null, notificationShadeOpen: boolean) {
    return Boolean(
      message &&
        message.id.startsWith("broken-link-") &&
        message.body === INITIAL_MESSAGE_LINK_TUTORIAL_BODY &&
        currentAppId === null &&
        !notificationShadeOpen
    );
  }

  function surfaceMessageModeFor(message: AssistantMessage | undefined, currentAppId: AppId | null, notificationShadeOpen: boolean): SurfaceMessageMode {
    return isInitialMessageLinkTutorial(message, currentAppId, notificationShadeOpen) ? "search" : "dismissOnTap";
  }

  function visibleSurfaceMessageFor(message: AssistantMessage | undefined, currentAppId: AppId | null, notificationShadeOpen: boolean) {
    if (message?.body === INITIAL_MESSAGE_LINK_TUTORIAL_BODY && (currentAppId !== null || notificationShadeOpen)) {
      return undefined;
    }

    return message;
  }

  function compactDateLabel(dateLabel: string) {
    const monthDayMatch = /(\d{1,2})月(\d{1,2})日/.exec(dateLabel);
    if (monthDayMatch) {
      return `${monthDayMatch[1]}/${monthDayMatch[2]}`;
    }

    const slashMatch = /(\d{1,2}\/\d{1,2})/.exec(dateLabel);
    return slashMatch?.[1] ?? "今日";
  }

  function mergePlayerState(
    baseState: DeviceState,
    state: PlayerState | null,
    pendingMessages: GameOverTalkMessage[],
    temporaryMessages: GameOverTalkMessage[],
    displayedNotificationTarget: DisplayedTalkTarget | null,
    suppressedNotificationIds: string[]
  ): DeviceState {
    if (!state) {
      return {
        ...baseState,
        notifications: suppressDisplayedTalkNotifications(baseState.notifications, displayedNotificationTarget, suppressedNotificationIds)
      };
    }

    const visibleBaseState = mergeVisibleDeviceState(baseState, state.visibleDeviceState ?? {});
    const availablePhotos = applyContentAvailability(visibleBaseState.photos, state, corruptPhoto);
    const availableRadioItems = applyContentAvailability(visibleBaseState.radioItems, state, corruptRadioItem);
    const messageThreads = mergeSmsMessages(
      visibleBaseState.messages,
      state,
      availablePhotos,
      availableRadioItems,
      pendingMessages,
      temporaryMessages
    );
    const chatThreads = mergeChatMessages(
      visibleBaseState.chatThreads,
      state,
      availablePhotos,
      availableRadioItems,
      pendingMessages,
      temporaryMessages
    );

    const scenarioTime = state.scenarioTime ?? {
      dateLabel: visibleBaseState.currentDateLabel,
      timeLabel: visibleBaseState.currentTimeLabel
    };

    const availableChatThreads = applyContentAvailability(chatThreads, state, corruptChatThread);

    return {
      ...visibleBaseState,
      currentDateLabel: scenarioTime.dateLabel,
      currentTimeLabel: scenarioTime.timeLabel,
      messages: applyContentAvailability(messageThreads, state, corruptMessageThread),
      photos: availablePhotos,
      notes: applyContentAvailability(visibleBaseState.notes, state, corruptNote),
      calendarEvents: applyContentAvailability(visibleBaseState.calendarEvents, state, corruptCalendarEvent),
      radioItems: availableRadioItems,
      chatThreads: availableChatThreads,
      chatAuthGate: visibleBaseState.chatAuthGate,
      apps: visibleBaseState.apps,
      todos: state.todos ?? visibleBaseState.todos,
      callLogs: visibleBaseState.callLogs,
      notifications: suppressDisplayedTalkNotifications(visibleBaseState.notifications, displayedNotificationTarget, suppressedNotificationIds)
    };
  }

  function mergeVisibleDeviceState(baseState: DeviceState, visibleState: Partial<DeviceState>): DeviceState {
    return {
      ...baseState,
      messages: visibleState.messages ?? baseState.messages,
      photos: visibleState.photos ?? baseState.photos,
      notes: visibleState.notes ?? baseState.notes,
      calendarEvents: visibleState.calendarEvents ?? baseState.calendarEvents,
      callLogs: visibleState.callLogs ?? baseState.callLogs,
      radioItems: visibleState.radioItems ?? baseState.radioItems,
      chatThreads: visibleState.chatThreads ?? baseState.chatThreads,
      chatAuthGate: visibleState.chatAuthGate,
      notifications: visibleState.notifications ?? baseState.notifications,
      apps: visibleState.apps ?? baseState.apps,
      todos: visibleState.todos ?? baseState.todos,
      wallpaperUrl: visibleState.wallpaperUrl ?? baseState.wallpaperUrl,
      incomingCall: visibleState.incomingCall ?? baseState.incomingCall
    };
  }

  function unreadAppIdsForDeviceState(state: DeviceState): AppId[] {
    return [
      ...(state.messages.some((thread) => thread.unread) ? (["messages"] as AppId[]) : []),
      ...(state.chatThreads.some((thread) => thread.unread) ? (["chat"] as AppId[]) : [])
    ];
  }

  function applyLocalTalkReadCursors(state: DeviceState, cursors: Record<string, string>): DeviceState {
    const messages = applyLocalTalkReadToThreads(state.messages, cursors);
    const chatThreads = applyLocalTalkReadToThreads(state.chatThreads, cursors);

    if (messages === state.messages && chatThreads === state.chatThreads) {
      return state;
    }

    return {
      ...state,
      messages,
      chatThreads
    };
  }

  function applyLocalTalkReadToThreads<T extends { id: string; unread?: boolean; messages: Array<{ id: string; sender?: string }> }>(
    threads: T[],
    cursors: Record<string, string>
  ): T[] {
    let changed = false;
    const nextThreads = threads.map((thread) => {
      if (!thread.unread || !cursors[thread.id]) {
        return thread;
      }

      const latestOtherMessageId = latestOtherTalkMessageId(thread.messages);
      if (!latestOtherMessageId || latestOtherMessageId !== cursors[thread.id]) {
        return thread;
      }

      changed = true;
      const { unread: _unread, ...readThread } = thread;
      return readThread as T;
    });

    return changed ? nextThreads : threads;
  }

  function latestOtherTalkMessageId(messages: Array<{ id: string; sender?: string }>) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.sender === "other") {
        return message.id;
      }
    }

    return "";
  }

  function notificationMatchesDisplayedTalk(notification: NotificationItem, target: DisplayedTalkTarget) {
    return notification.appId === target.appId && notification.targetContentId === target.contentId;
  }

  function suppressDisplayedTalkNotifications(
    notifications: NotificationItem[],
    target: DisplayedTalkTarget | null,
    suppressedNotificationIds: string[]
  ) {
    const suppressedIds = new Set(suppressedNotificationIds);
    return notifications.filter(
      (notification) => !suppressedIds.has(notification.id) && (!target || !notificationMatchesDisplayedTalk(notification, target))
    );
  }

  function syncDisplayedTalkNotificationSuppression(notifications: NotificationItem[], target: DisplayedTalkTarget | null) {
    const currentNotificationIds = new Set(notifications.map((notification) => notification.id));
    if (locallySuppressedNotificationIds.some((notificationId) => !currentNotificationIds.has(notificationId))) {
      locallySuppressedNotificationIds = locallySuppressedNotificationIds.filter((notificationId) => currentNotificationIds.has(notificationId));
    }

    if (!target) {
      return;
    }

    const newlySuppressedIds = notifications
      .filter((notification) => notificationMatchesDisplayedTalk(notification, target))
      .map((notification) => notification.id)
      .filter((notificationId) => !locallySuppressedNotificationIds.includes(notificationId));

    if (!newlySuppressedIds.length) {
      return;
    }

    locallySuppressedNotificationIds = [...locallySuppressedNotificationIds, ...newlySuppressedIds];
    if (notificationToast && newlySuppressedIds.includes(notificationToast.id)) {
      notificationToast = null;
      window.clearTimeout(notificationToastTimer);
    }
    void handleContentOpen(target.appId, target.contentId, { ignoreSuppression: true, skipRemember: true }).then((accepted) => {
      if (accepted) {
        return;
      }

      locallySuppressedNotificationIds = locallySuppressedNotificationIds.filter(
        (notificationId) => !newlySuppressedIds.includes(notificationId)
      );
    });
  }

  function visibleOtherTalkMessageIds(talkId: string) {
    const thread = deviceState.messages.find((item) => item.id === talkId) ?? deviceState.chatThreads.find((item) => item.id === talkId);
    if (!thread) {
      return [];
    }

    return thread.messages.filter((message) => message.sender === "other").map((message) => message.id);
  }

  function localTalkReadCursorCanAdvance(talkId: string, messageId: string) {
    const messageIds = visibleOtherTalkMessageIds(talkId);
    const requestedIndex = messageIds.indexOf(messageId);
    if (requestedIndex < 0) {
      return false;
    }

    const currentCursor = uiState.localTalkReadCursors[talkId] ?? "";
    const currentIndex = currentCursor ? messageIds.indexOf(currentCursor) : -1;
    return requestedIndex >= currentIndex;
  }

  function appIdFromQuery(value: string | null): AppId | null {
    if (!value) {
      return null;
    }

    return new Set(["phone", "messages", "notes", "photos", "calendar", "radio", "chat"])
      .has(value) ? (value as AppId) : null;
  }

  function applyContentAvailability<T extends ScenarioContentMeta>(
    items: T[],
    state: PlayerState,
    corruptor: (item: T) => T
  ) {
    const contentStates = new Map(state.contentStates.map((item) => [item.contentId, item.state]));

    return items.flatMap((item) => {
      if (!item.contentId || !item.initialState || item.initialState === "normal") {
        return [item];
      }

      const currentState = contentStates.get(item.contentId);
      const repaired = currentState === "repaired" || currentState === "unlocked";

      if (item.initialState === "hidden") {
        return repaired ? [{ ...item, corrupted: false }] : [];
      }

      return [
        repaired
          ? { ...item, corrupted: false }
          : corruptor({ ...item, corrupted: true })
      ];
    });
  }

  function corruptPhoto(photo: PhotoItem): PhotoItem {
    return {
      ...photo
    };
  }

  function repairDisplayLabel(item: ScenarioContentMeta, fallback: string) {
    return item.repairLabel?.trim() || fallback;
  }

  function corruptNote(note: NoteItem): NoteItem {
    return {
      ...note,
      title: repairDisplayLabel(note, "□□□□□□"),
      body: "<ERROR コンテンツへのリンクが破損しています>"
    };
  }

  function corruptCalendarEvent(event: CalendarEvent): CalendarEvent {
    return {
      ...event,
      title: repairDisplayLabel(event, "破損した予定"),
      date: "--/--",
      time: "--:--",
      place: "取得不能",
      memo: "予定データが壊れています。"
    };
  }

  function corruptRadioItem(item: RadioEpisodeItem): RadioEpisodeItem {
    return {
      ...item,
      programTitle: repairDisplayLabel(item, "□□□□□□ □□□□□"),
      audioUrl: undefined
    };
  }

  function corruptMessageThread(thread: MessageThread): MessageThread {
    return {
      ...thread,
      contactName: repairDisplayLabel(thread, "□□□□□□"),
      messages: [
        {
          id: `${thread.id}-corrupted`,
          sender: "other",
          body: "□□□□□□ □□□□□□",
          sentAt: "--:--"
        }
      ]
    };
  }

  function corruptChatThread(thread: ChatAppThread): ChatAppThread {
    return {
      ...thread,
      roomName: repairDisplayLabel(thread, "□□□□□□"),
      messages: [
        {
          id: `${thread.id}-corrupted`,
          sender: "other",
          senderName: "匿名",
          body: "□□□□□□ □□□□□□",
          sentAt: "--:--"
        }
      ]
    };
  }

  function photoAttachmentFromBody(body: string, photos: PhotoItem[]): MessageAttachment | undefined {
    const photoId = photoMessagePattern.exec(body.trim())?.[1];
    if (!photoId) {
      return undefined;
    }

    const photo = photos.find((item) => (item.contentId ?? item.id) === photoId && (item.imageUrl || item.audioUrl) && !item.corrupted);
    if (!photo?.imageUrl && !photo?.audioUrl) {
      return undefined;
    }

    if (photo.mediaKind === "still_video" && photo.audioUrl) {
      return {
        kind: "audio",
        ...(photo.attachmentId ? { attachmentId: photo.attachmentId } : {}),
        contentId: photo.contentId ?? photo.id,
        ...(photo.imageUrl ? { imageUrl: photo.imageUrl } : {}),
        audioUrl: photo.audioUrl
      };
    }

    return {
      kind: "image",
      ...(photo.attachmentId ? { attachmentId: photo.attachmentId } : {}),
      contentId: photo.contentId ?? photo.id,
      imageUrl: photo.imageUrl ?? ""
    };
  }

  function radioContentId(item: RadioEpisodeItem) {
    return item.contentId ?? item.id;
  }

  function shareAttachmentFromBody(body: string, radioItems: RadioEpisodeItem[]): MessageAttachment | undefined {
    const contentId = shareMessagePattern.exec(body.trim())?.[1];
    if (!contentId) {
      return undefined;
    }

    const radioItem = radioItems.find((item) => radioContentId(item) === contentId && !item.corrupted);
    if (!radioItem) {
      return undefined;
    }

    return {
      kind: "share",
      appId: "radio",
      contentId: radioContentId(radioItem),
      title: radioItem.programTitle
    };
  }

  function talkMessageBody(body: string, attachment: MessageAttachment | undefined) {
    const normalized = body.trim();
    return attachment && (photoMessagePattern.test(normalized) || shareMessagePattern.test(normalized)) ? "" : body;
  }

  function mergeSmsMessages(
    baseThreads: MessageThread[],
    state: PlayerState,
    photos: PhotoItem[],
    radioItems: RadioEpisodeItem[],
    pendingMessages: GameOverTalkMessage[],
    temporaryMessages: GameOverTalkMessage[]
  ) {
    const contentStates = new Map(state.contentStates.map((item) => [item.contentId, item.state]));
    const unlockedAttachments = new Map((state.unlockedAttachments ?? []).map((item) => [item.contentId, item]));
    const threads = baseThreads.map((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => applyAttachmentState(message, contentStates, unlockedAttachments))
    }));

    const smsMessages = [
      ...state.smsMessages,
      ...pendingMessages.filter((message) => message.kind === "sms"),
      ...temporaryMessages.filter((message) => message.kind === "sms")
    ];

    for (const smsMessage of smsMessages) {
      let thread = threads.find((item) => item.id === smsMessage.talkId);

      if (!thread) {
        continue;
      }

      if (thread.messages.some((message) => message.id === smsMessage.id)) {
        continue;
      }

      const generatedAttachment = photoAttachmentFromBody(smsMessage.body, photos) ?? shareAttachmentFromBody(smsMessage.body, radioItems);
      const attachment = generatedAttachment ?? smsMessage.attachment ?? undefined;
      const message: Message = {
        id: smsMessage.id,
        sender: smsMessage.sender === "other" ? "other" : "owner",
        body: talkMessageBody(smsMessage.body, attachment),
        ...(smsMessage.avatarUrl ? { avatarUrl: smsMessage.avatarUrl } : {}),
        ...(smsMessage.segments ? { segments: smsMessage.segments } : {}),
        sentAt: new Date(smsMessage.sentAt).toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit"
        }),
        ...(typeof smsMessage.delayMs === "number" ? { delayMs: smsMessage.delayMs } : {}),
        ...(smsMessage.delayOnFirstDisplay ? { delayOnFirstDisplay: true } : {}),
        attachment
      };
      thread.messages.push(applyAttachmentState(message, contentStates, unlockedAttachments));
    }

    return threads;
  }

  function applyAttachmentState(
    message: Message,
    contentStates: Map<string, string>,
    unlockedAttachments: Map<string, { title: string; body: string; imageUrl?: string }>
  ): Message {
    if (!message.attachment) {
      return message;
    }

    if (!isLockedAttachment(message.attachment)) {
      return message;
    }

    const locked = contentStates.get(message.attachment.contentId) !== "unlocked";
    const unlocked = unlockedAttachments.get(message.attachment.contentId);
    const attachment: MessageAttachment = {
      ...message.attachment,
      locked,
      ...(locked || !unlocked
        ? {}
        : {
            unlockedTitle: unlocked.title,
            unlockedBody: unlocked.body,
            ...(unlocked.imageUrl ? { unlockedImageUrl: unlocked.imageUrl } : {})
          })
    };

    return { ...message, attachment };
  }

  function isLockedAttachment(attachment: MessageAttachment): attachment is LockedAttachment {
    return !attachment.kind || attachment.kind === "locked";
  }

  function mergeChatMessages(
    baseThreads: ChatAppThread[],
    state: PlayerState,
    photos: PhotoItem[],
    radioItems: RadioEpisodeItem[],
    pendingMessages: GameOverTalkMessage[],
    temporaryMessages: GameOverTalkMessage[]
  ) {
    const threads = baseThreads.map((thread) => ({
      ...thread,
      messages: [...thread.messages]
    }));

    const chatMessages = [
      ...state.chatMessages,
      ...pendingMessages.filter((message) => message.kind === "chat"),
      ...temporaryMessages.filter((message) => message.kind === "chat")
    ];

    for (const chatMessage of chatMessages) {
      let thread = threads.find((item) => item.id === chatMessage.talkId);

      if (!thread) {
        continue;
      }

      if (thread.messages.some((message) => message.id === chatMessage.id)) {
        continue;
      }

      const generatedAttachment = photoAttachmentFromBody(chatMessage.body, photos) ?? shareAttachmentFromBody(chatMessage.body, radioItems);
      const attachment = generatedAttachment ?? chatMessage.attachment ?? undefined;
      const message: ChatAppMessage = {
        id: chatMessage.id,
        sender: chatMessage.sender,
        senderName: chatMessage.senderName ?? (chatMessage.sender === "owner" ? "あなた" : "匿名"),
        body: talkMessageBody(chatMessage.body, attachment),
        ...(chatMessage.avatarUrl ? { avatarUrl: chatMessage.avatarUrl } : {}),
        ...(chatMessage.segments ? { segments: chatMessage.segments } : {}),
        sentAt: new Date(chatMessage.sentAt).toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit"
        }),
        ...(typeof chatMessage.delayMs === "number" ? { delayMs: chatMessage.delayMs } : {}),
        ...(chatMessage.delayOnFirstDisplay ? { delayOnFirstDisplay: true } : {}),
        attachment
      };
      thread.messages.push(message);
    }

    return threads;
  }

  function persist(partial: Partial<PersistedUiState>) {
    uiState = { ...uiState, ...partial };
    saveUiState(uiState);
  }

  function currentPhoneRoute(): PhoneHistoryRoute {
    return activeAppId
      ? { kind: "app", appId: activeAppId, ...(focusedContentId ? { contentId: focusedContentId } : {}) }
      : { kind: "home" };
  }

  function initializePhoneHistory() {
    if (qaMode) {
      return;
    }
    phoneHistoryReady = true;
    replacePhoneHistoryRoute(window.history, phoneHistoryScope, currentPhoneRoute());
  }

  function resetPhoneHistoryBoundary(route: PhoneHistoryRoute = { kind: "home" }) {
    phoneHistoryNavigationId += 1;
    if (!phoneHistoryReady || qaMode) {
      return;
    }
    phoneHistoryScope = crypto.randomUUID();
    replacePhoneHistoryRoute(window.history, phoneHistoryScope, route);
  }

  function pushCurrentPhoneRoute(route: PhoneHistoryRoute) {
    phoneHistoryNavigationId += 1;
    if (!phoneHistoryReady || qaMode) {
      return;
    }
    pushPhoneHistoryRoute(window.history, phoneHistoryScope, route);
  }

  function replaceCurrentPhoneRoute(route: PhoneHistoryRoute) {
    if (!phoneHistoryReady || qaMode) {
      return;
    }
    replacePhoneHistoryRoute(window.history, phoneHistoryScope, route);
  }

  function syncPhoneHistoryContent(appId: AppId, contentId: string) {
    const current = phoneHistoryStateFrom(window.history.state, phoneHistoryScope);
    if (current?.route.kind === "app" && current.route.appId === appId) {
      replaceCurrentPhoneRoute({ kind: "app", appId, contentId });
    }
  }

  function clearPhoneRoute() {
    activeAppId = null;
    focusedContentId = "";
    shadeOpen = false;
    inFlightContentOpenKeys = [];
    inFlightMediaObservedKeys = [];
    suppressedContentOpenKeys = [];
    transientAssistantMessage = undefined;
    temporaryTalkBackLink = null;
  }

  function handlePhoneHistoryPop(event: PopStateEvent) {
    const state = phoneHistoryStateFrom(event.state);
    if (!state || qaMode) {
      return;
    }

    if (state.scope !== phoneHistoryScope || uiState.locked || !uiState.sessionToken || outOfGameVisible || gameOverVisible || allClearVisible || activeIncomingCall) {
      clearPhoneRoute();
      replaceCurrentPhoneRoute({ kind: "home" });
      return;
    }

    const navigationId = ++phoneHistoryNavigationId;
    void restorePhoneHistoryRoute(state.route, navigationId);
  }

  async function restorePhoneHistoryRoute(route: PhoneHistoryRoute, navigationId: number) {
    if (!uiState.sessionToken) {
      return;
    }
    const sessionToken = uiState.sessionToken;

    if (route.kind === "home") {
      if (!await refreshPlayerStateWithRetry(sessionToken, "AP-STATE") || navigationId !== phoneHistoryNavigationId) {
        return;
      }
      clearPhoneRoute();
      return;
    }

    if (!route.contentId) {
      if (!await refreshPlayerStateWithRetry(sessionToken, "AP-STATE") || navigationId !== phoneHistoryNavigationId) {
        return;
      }
      const app = apps.find((item) => item.id === route.appId && item.available);
      if (!app) {
        fallbackPhoneHistoryToHome();
        return;
      }
      focusAppContent(route.appId, "", false);
      return;
    }

    const opened = await openPhoneHistoryContent(route.appId, route.contentId, navigationId);
    if (navigationId !== phoneHistoryNavigationId) {
      return;
    }
    if (!opened && !globalErrorVisible) {
      fallbackPhoneHistoryToHome();
      return;
    }
    if (!opened) {
      return;
    }
    focusOpenedContent(route.appId, route.contentId, false);
  }

  async function openPhoneHistoryContent(appId: AppId, contentId: string, navigationId: number) {
    for (let attempt = 0; ; attempt += 1) {
      while (inFlightContentOpenKeys.includes(contentOpenKey(appId, contentId))) {
        if (navigationId !== phoneHistoryNavigationId) {
          return false;
        }
        await waitMs(50);
      }

      try {
        return await handleContentOpen(appId, contentId, {
          ignoreSuppression: true,
          skipRemember: true,
          throwOnRetryableError: true,
          historyRestore: true
        });
      } catch (error) {
        if (navigationId !== phoneHistoryNavigationId) {
          return false;
        }
        if (attempt >= PROGRESSION_RETRY_DELAYS_MS.length) {
          showGlobalError(error, { supportCode: "AP-STATE" });
          return false;
        }
      }
      await waitMs(PROGRESSION_RETRY_DELAYS_MS[attempt]);
    }
  }

  function fallbackPhoneHistoryToHome() {
    clearPhoneRoute();
    replaceCurrentPhoneRoute({ kind: "home" });
  }

  function rememberAppOpened(appId: AppId) {
    if (!uiState.openedAppIds.includes(appId)) {
      persist({ openedAppIds: [...uiState.openedAppIds, appId] });
    }
  }

  function rememberAppContent(appId: AppId, contentId: string) {
    if (!contentId || uiState.lastContentByAppId[appId] === contentId) {
      return;
    }

    persist({
      lastContentByAppId: {
        ...uiState.lastContentByAppId,
        [appId]: contentId
      }
    });
  }

  function contentOpenKey(appId: AppId, contentId: string) {
    return `${appId}:${contentId}`;
  }

  function mediaObservedKey(appId: AppId, contentId: string) {
    return `media:${appId}:${contentId}`;
  }

  function pendingTalkReadCursorPayload(): TalkReadCursorPayload[] {
    const messages = [...(playerState?.smsMessages ?? []), ...(playerState?.chatMessages ?? [])];
    return Object.entries(uiState.pendingTalkReadCursors).flatMap(([talkId, messageId]) => {
      const message = messages.find((item) => item.talkId === talkId && item.id === messageId && item.sender === "other");
      return message && typeof message.seq === "number" ? [{ talkId, messageId, messageSeq: message.seq }] : [];
    });
  }

  function clearSyncedTalkReadCursors(cursors: TalkReadCursorPayload[]) {
    if (!cursors.length) {
      return;
    }

    let changed = false;
    const nextPending = { ...uiState.pendingTalkReadCursors };
    for (const cursor of cursors) {
      if (nextPending[cursor.talkId] !== cursor.messageId) {
        continue;
      }
      delete nextPending[cursor.talkId];
      changed = true;
    }

    if (changed) {
      persist({ pendingTalkReadCursors: nextPending });
    }
  }

  function suppressNextContentOpenReport(appId: AppId, contentId: string) {
    const key = contentOpenKey(appId, contentId);
    if (!suppressedContentOpenKeys.includes(key)) {
      suppressedContentOpenKeys = [...suppressedContentOpenKeys, key];
    }
  }

  function focusAppContent(appId: AppId, contentId: string, addHistory = true) {
    shadeOpen = false;
    focusedContentId = contentId;
    focusedContentRequestId += 1;
    transientAssistantMessage = undefined;
    suppressedContentOpenKeys = [];
    activeAppId = appId;
    trackEvent({ name: "app_open", appId });
    rememberAppOpened(appId);
    if (addHistory) {
      pushCurrentPhoneRoute({ kind: "app", appId, ...(contentId ? { contentId } : {}) });
    }
  }

  function focusOpenedContent(appId: AppId, contentId: string, addHistory = true) {
    focusAppContent(appId, contentId, addHistory);
    suppressNextContentOpenReport(appId, contentId);
  }

  function showTalkBackLink(sourceAppId: TalkBackLinkAppId | null, targetAppId: AppId) {
    if (!sourceAppId || sourceAppId === targetAppId) {
      return;
    }

    temporaryTalkBackLink = {
      sourceAppId,
      targetAppId
    };
  }

  function openTalkBackLink() {
    const link = temporaryTalkBackLink;
    if (!link) {
      return;
    }

    temporaryTalkBackLink = null;
    notificationToast = null;
    appModalOpen = false;
    const app = apps.find((item) => item.id === link.sourceAppId);
    if (app && !goBackInPhoneHistory(window.history, phoneHistoryScope, link.sourceAppId)) {
      openApp(app);
    }
  }

  function clearLocalPlayerStateForReset() {
    clearPlayerStateCache();
    clearSearchAgentLocalMessages();
    clearTalkDelaySeenMessagesForMemoryKey(localPlayerMemoryKey(playerMode, uiState.sessionToken));
    clearStartConfirmationForReset();
    clearRuntimeState();
    persist({
      locked: true,
      openedAppIds: [],
      lastContentByAppId: {},
      localTalkReadCursors: {},
      pendingTalkReadCursors: {}
    });
  }

  function clearLocalAuthenticationForLogout() {
    if (qaMode) {
      return;
    }

    clearPlayerStateCache();
    clearTranscriptStorage();
    clearTalkDelaySeenMessagesForMemoryKey(localPlayerMemoryKey(playerMode, uiState.sessionToken));
    clearRuntimeState();
    playerState = null;
    persist({
      locked: true,
      sessionToken: undefined,
      serialCounter: undefined
    });
  }

  function clearStartConfirmationForReset() {
    if (qaMode) {
      return;
    }

    clearStartConfirmation();
    startConfirmationDone = false;
  }

  function shouldResetPlayerStateFromUrl() {
    const path = window.location.pathname.replace(/\/+$/, "");
    return resetForTestingEnabled && path.endsWith(RESET_FOR_TESTING_PATH_SUFFIX);
  }

  function clearResetPlayerStateUrl() {
    if (shouldResetPlayerStateFromUrl()) {
      window.history.replaceState(window.history.state, "", "/");
    }
  }

  function shouldLogoutFromUrl() {
    const path = window.location.pathname.replace(/\/+$/, "");
    return path.endsWith(LOGOUT_PATH_SUFFIX);
  }

  function clearLogoutUrl() {
    if (shouldLogoutFromUrl()) {
      window.history.replaceState(window.history.state, "", "/");
    }
  }

  function clearRuntimeState() {
    stopRadioPlayback();
    activeAppId = null;
    shadeOpen = false;
    noiseVisible = false;
    pendingNotificationOpen = null;
    incomingCall = undefined;
    locallyCompletedIncomingCallIds = [];
    focusedContentId = "";
    inFlightContentOpenKeys = [];
    inFlightMediaObservedKeys = [];
    suppressedContentOpenKeys = [];
    transientAssistantMessage = undefined;
    appModalOpen = false;
    displayedTalkTarget = null;
    temporaryTalkBackLink = null;
    locallySuppressedNotificationIds = [];
    notificationToast = null;
    seenNotificationIds = [];
    notificationTrackingInitialized = false;
    temporaryTalkMessages = [];
    pendingTalkMessages = [];
    replyDelayAnchorsByThread = {};
    gameOverVisible = false;
    gameOverReturning = false;
    gameOverTalk = null;
    gameOverReasonMessage = "";
    allClearVisible = false;
    allClearReturning = false;
    allClearTarget = null;
    allClearAutoplay = false;
    radioAutoplayContentId = "";
    radioAutoplayRequestId = 0;
    pendingShareDraft = null;
    window.clearTimeout(noiseTimer);
    window.clearTimeout(notificationToastTimer);
    window.clearTimeout(gameOverOverlayTimer);
    window.clearTimeout(allClearOverlayTimer);
    clearScenarioWakeTimer();
    resetPhoneHistoryBoundary();
  }

  async function resetPlayerForTesting() {
    if (!uiState.sessionToken) {
      return false;
    }

    try {
      const result = await resetPlayerState(uiState.sessionToken);
      if (result.ok) {
        applyPlayerState(result.playerState);
        return true;
      }

      applyErrorPlayerState(result);
      if (result.error === "unauthorized") {
        clearTalkDelaySeenMessagesForMemoryKey(localPlayerMemoryKey(playerMode, uiState.sessionToken));
        persist({
          locked: true,
          sessionToken: undefined,
          serialCounter: undefined,
          openedAppIds: [],
          lastContentByAppId: {},
          localTalkReadCursors: {},
          pendingTalkReadCursors: {}
        });
      }
    } catch {
      return false;
    }

    return false;
  }

  async function resetPlayerStateFromUrl() {
    if (await resetPlayerForTesting()) {
      clearLocalPlayerStateForReset();
    } else {
      clearStartConfirmationForReset();
    }
    clearResetPlayerStateUrl();
  }

  function logoutPlayerFromUrl() {
    clearLocalAuthenticationForLogout();
    clearLogoutUrl();
    trackEvent({ name: "logout", source: "url_suffix" });
  }

  function confirmStart() {
    saveStartConfirmation();
    startConfirmationDone = true;
    if (uiState.sessionToken && !uiState.locked) {
      void refreshPlayerStateWithRetry(uiState.sessionToken, "AP-STATE");
    }
  }

  async function refreshPlayerState(sessionToken: string) {
    lastPlayerStateRefreshRequestedAt = Date.now();
    const result = await loadPlayerState(sessionToken);

    if (result.ok) {
      applyPlayerState(result.playerState);
      return;
    }

    if (result.error === "unauthorized") {
      clearPlayerStateCache();
      clearTalkDelaySeenMessagesForMemoryKey(localPlayerMemoryKey(playerMode, uiState.sessionToken));
      clearPhoneRoute();
      persist({
        locked: true,
        sessionToken: undefined,
        serialCounter: undefined,
        openedAppIds: [],
        lastContentByAppId: {},
        localTalkReadCursors: {},
        pendingTalkReadCursors: {}
      });
      resetPhoneHistoryBoundary();
      return;
    }

    if (showBrowserProgressSizeError(result.error)) {
      return;
    }

    throw new Error(`player_state_refresh_failed:${result.error}`);
  }

  async function refreshPlayerStateWithRetry(sessionToken: string, supportCode: "AP-EVENT" | "AP-STATE") {
    for (let attempt = 0; ; attempt += 1) {
      if (uiState.sessionToken !== sessionToken || uiState.locked || outOfGameVisible) {
        return false;
      }

      try {
        await refreshPlayerState(sessionToken);
        return true;
      } catch (error) {
        if (attempt >= PROGRESSION_RETRY_DELAYS_MS.length) {
          showGlobalError(error, { supportCode });
          return false;
        }
      }

      await waitMs(PROGRESSION_RETRY_DELAYS_MS[attempt]);
    }
  }

  function clearScenarioWakeTimer() {
    window.clearTimeout(scenarioWakeTimer);
    scenarioWakeTimer = undefined;
    scenarioWakeTimerKey = "";
  }

  function syncScenarioWakeTimer(wakeAt: string | null, sessionToken: string | undefined, locked: boolean, suspended: boolean) {
    if (qaMode || !wakeAt || !sessionToken || locked || suspended) {
      clearScenarioWakeTimer();
      return;
    }

    const wakeTime = Date.parse(wakeAt);
    if (!Number.isFinite(wakeTime)) {
      clearScenarioWakeTimer();
      return;
    }

    const key = `${sessionToken}:${wakeAt}`;
    if (scenarioWakeTimer !== undefined && scenarioWakeTimerKey === key) {
      return;
    }

    window.clearTimeout(scenarioWakeTimer);
    scenarioWakeTimerKey = key;
    scenarioWakeTimer = window.setTimeout(() => {
      if (scenarioWakeTimerKey !== key || !uiState.sessionToken || uiState.locked) {
        scenarioWakeTimer = undefined;
        return;
      }

      const sessionTokenAtWake = uiState.sessionToken;
      void refreshPlayerStateWithRetry(sessionTokenAtWake, "AP-EVENT").then(() => {
        if (scenarioWakeTimerKey !== key) {
          return;
        }
        scenarioWakeTimer = undefined;
        syncScenarioWakeTimer(playerState?.nextScenarioWakeAt ?? null, uiState.sessionToken, uiState.locked, outOfGameVisible);
      });
    }, Math.max(0, Math.min(wakeTime - Date.now(), SCENARIO_WAKE_TIMER_MAX_MS)));
  }

  function refreshPlayerStateOnHomeIfStale() {
    if (qaMode || !uiState.sessionToken || uiState.locked) {
      return;
    }

    const elapsedMs = Date.now() - lastPlayerStateRefreshRequestedAt;
    if (lastPlayerStateRefreshRequestedAt > 0 && elapsedMs < PLAYER_STATE_HOME_REFRESH_INTERVAL_MS) {
      return;
    }

    void refreshPlayerState(uiState.sessionToken).catch(() => undefined);
  }

  async function unlockDevice(serialCode: string) {
    try {
      const existingBrowserToken = playerMode === "browser" ? loadBrowserProgressToken() : undefined;
      const loaded = existingBrowserToken ? await loadPlayerState(existingBrowserToken) : null;
      const result = loaded?.ok
        ? { ...loaded, sessionToken: loaded.playerState.progressToken ?? existingBrowserToken }
        : loaded && loaded.error !== "unauthorized"
          ? loaded
          : await startSession(serialCode);

      if (!result.ok) {
        applyErrorPlayerState(result);
        return { ok: false, error: result.error };
      }

      const sessionChanged = playerSessionChanged(
        playerMode,
        uiState.sessionToken,
        result.sessionToken,
        Boolean(existingBrowserToken && loaded?.ok)
      );
      if (sessionChanged) {
        clearTalkDelaySeenMessagesForMemoryKey(localPlayerMemoryKey(playerMode, uiState.sessionToken));
      }
      persist({
        locked: false,
        sessionToken: result.sessionToken,
        serialCounter: result.playerState.serialCounter,
        ...(sessionChanged
          ? {
              openedAppIds: [],
              lastContentByAppId: {},
              localTalkReadCursors: {},
              pendingTalkReadCursors: {}
            }
          : {})
      });
      if (sessionChanged) {
        displayedTalkTarget = null;
        locallySuppressedNotificationIds = [];
      }
      applyPlayerState(result.playerState, { force: sessionChanged });
      if (pendingNotificationOpen) {
        const pendingOpen = pendingNotificationOpen;
        const pendingApp = apps.find((app) => app.id === pendingOpen.appId);
        pendingNotificationOpen = null;
        if (pendingApp) {
          openAppContent(pendingApp, pendingOpen.contentId);
        }
      }
      trackEvent({ name: "unlock_device" });
      return { ok: true };
    } catch {
      return { ok: false, error: "server_unavailable" };
    }
  }

  async function lockDevice() {
    const sourceAppId = activeAppId ?? undefined;
    const reset = resetForTestingEnabled && await resetPlayerForTesting();
    if (reset) {
      clearLocalPlayerStateForReset();
    } else {
      clearRuntimeState();
      persist({ locked: true });
    }
    trackEvent({ name: "lock_device", ...(sourceAppId ? { appId: sourceAppId } : {}) });
  }

  function triggerNoise(durationMs = 100) {
    noiseVisible = true;
    window.clearTimeout(noiseTimer);
    noiseTimer = window.setTimeout(() => {
      noiseVisible = false;
    }, durationMs);
  }

  function stopBackgroundMediaPlayback() {
    stopAudioPlayback("incoming_call");
    radioPlaybackSerial += 1;
    radioPlayback = emptyRadioPlaybackState(radioPlaybackSerial);
    radioPlaybackLoadingItemId = "";
    window.dispatchEvent(new CustomEvent("xstoryphone:stop-audio-playback", { detail: { reason: "incoming_call" } }));

    for (const media of document.querySelectorAll<HTMLMediaElement>("audio, video")) {
      try {
        media.pause();
        media.currentTime = 0;
      } catch (error) {
        // 読み込み前や破棄中の media は停止や currentTime 変更に失敗することがある。
        console.warn("[media:stop]", error);
      }
    }
  }

  function handleIncomingCallEvent(event: Event) {
    const detail = (event as CustomEvent<IncomingCallItem>).detail;

    if (!detail?.id || !detail.name) {
      return;
    }

    if (locallyCompletedIncomingCallIds.includes(detail.id)) {
      return;
    }

    resetPhoneHistoryBoundary();
    incomingCall = detail;
    shadeOpen = false;
    noiseVisible = false;
    window.clearTimeout(noiseTimer);
  }

  function handleAudioPlaybackComplete(event: Event) {
    const detail = (event as CustomEvent<{ contentId?: string; attachmentId?: string }>).detail;
    recordAudioPlaybackComplete(detail);
  }

  async function recordBackgroundScenarioEvent(
    sessionToken: string,
    eventId: string,
    payload: Record<string, unknown>,
    options: { stopWhenLocked?: boolean } = {}
  ) {
    // 致命的エラー画面へ移った後は、通信結果を適用せず再試行もしない。
    const shouldStop = () => globalErrorVisible
      || uiState.sessionToken !== sessionToken
      || (options.stopWhenLocked !== false && uiState.locked);

    for (let attempt = 0; ; attempt += 1) {
      if (shouldStop()) {
        return null;
      }

      try {
        const result = await recordScenarioEvent(sessionToken, eventId, payload);
        if (shouldStop()) {
          return null;
        }
        if (result.ok) {
          return result;
        }

        applyErrorPlayerState(result);
        if ((!result.retryable && result.error !== "conflict") || attempt >= PROGRESSION_RETRY_DELAYS_MS.length) {
          showGlobalError(result.error, { supportCode: "AP-EVENT" });
          return result;
        }
      } catch (error) {
        if (shouldStop()) {
          return null;
        }
        if (attempt >= PROGRESSION_RETRY_DELAYS_MS.length) {
          showGlobalError(error, { supportCode: "AP-EVENT" });
          return null;
        }
      }

      if (shouldStop()) {
        return null;
      }
      await waitMs(PROGRESSION_RETRY_DELAYS_MS[attempt]);
    }
  }

  async function dispatchProjectScenarioEvent(eventId: string, fields: Record<string, string> = {}) {
    if (globalErrorVisible) {
      return { ok: false as const, error: "event_unavailable" };
    }
    const sessionToken = uiState.sessionToken;
    if (!sessionToken) {
      return { ok: false as const, error: "unauthorized" };
    }
    const result = await recordBackgroundScenarioEvent(sessionToken, eventId, { fields }, { stopWhenLocked: false });
    if (globalErrorVisible) {
      return { ok: false as const, error: "event_unavailable" };
    }
    if (!result?.ok) {
      return { ok: false as const, error: result?.error ?? "event_unavailable" };
    }
    applyPlayerState(result.playerState);
    if (result.allClear) {
      showAllClear(result.allClear);
    }
    return { ok: true as const };
  }

  function handleProjectStageError(error: unknown) {
    showGlobalError(error, { supportCode: "AP-STAGE" });
  }

  function recordAudioPlaybackComplete(detail: { contentId?: string; attachmentId?: string } | undefined) {
    if (qaMode || (!detail?.contentId && !detail?.attachmentId) || !uiState.sessionToken) {
      return;
    }

    void recordBackgroundScenarioEvent(uiState.sessionToken, "audio_playback_completed", detail).then((result) => {
      if (!globalErrorVisible && result?.ok) {
        applyPlayerState(result.playerState);
      }
    });
  }

  function handleAudioCueReached(event: Event) {
    const detail = (event as CustomEvent<{ contentId?: string; cueIndex?: number }>).detail;
    recordAudioCueReached(detail);
  }

  function recordAudioCueReached(detail: { contentId?: string; cueIndex?: number } | undefined) {
    if (qaMode || !detail?.contentId || typeof detail.cueIndex !== "number" || !uiState.sessionToken) {
      return;
    }

    void recordBackgroundScenarioEvent(uiState.sessionToken, "audio_cue_reached", detail).then((result) => {
      if (!globalErrorVisible && result?.ok) {
        applyPlayerState(result.playerState);
      }
    });
  }

  function radioPlaybackId(itemId: string) {
    return `radio:${itemId}`;
  }

  function currentRadioPlaybackMatches(requestId: number, itemId: string, audioKey: string) {
    return radioPlayback.requestId === requestId && radioPlayback.itemId === itemId && radioPlayback.audioKey === audioKey;
  }

  function setRadioPlaybackProgress(requestId: number, itemId: string, audioKey: string, currentMs: number, durationMs: number, force = false) {
    if (!currentRadioPlaybackMatches(requestId, itemId, audioKey) || !radioPlayback.active) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastRadioPlaybackProgressAt < RADIO_PLAYBACK_PROGRESS_INTERVAL_MS) {
      return;
    }

    lastRadioPlaybackProgressAt = now;
    radioPlayback = {
      ...radioPlayback,
      currentMs,
      durationMs
    };
  }

  async function startRadioPlayback(request: RadioPlaybackStartRequest) {
    const { item, audioKey, segments, cues } = request;
    if (!segments.length) {
      return false;
    }

    const requestId = ++radioPlaybackSerial;
    const contentId = radioContentId(item);
    radioPlaybackLoadingItemId = item.id;
    lastRadioPlaybackProgressAt = 0;
    radioPlayback = {
      itemId: item.id,
      contentId,
      audioKey,
      currentMs: 0,
      durationMs: 0,
      active: false,
      requestId
    };

    const started = await playAudio({
      id: radioPlaybackId(item.id),
      segments,
      cues,
      onStarted: ({ durationMs }) => {
        if (!currentRadioPlaybackMatches(requestId, item.id, audioKey)) {
          return;
        }
        radioPlaybackLoadingItemId = "";
        radioPlayback = {
          ...radioPlayback,
          currentMs: 0,
          durationMs,
          active: true
        };
      },
      onProgress: ({ currentMs, durationMs }) => {
        setRadioPlaybackProgress(requestId, item.id, audioKey, currentMs, durationMs);
      },
      onCue: (cue) => {
        if (currentRadioPlaybackMatches(requestId, item.id, audioKey)) {
          recordAudioCueReached({ contentId, cueIndex: cue.index });
        }
      },
      onEnded: () => {
        if (!currentRadioPlaybackMatches(requestId, item.id, audioKey)) {
          return;
        }
        setRadioPlaybackProgress(requestId, item.id, audioKey, radioPlayback.durationMs, radioPlayback.durationMs, true);
        radioPlayback = emptyRadioPlaybackState(requestId);
        radioPlaybackLoadingItemId = "";
        recordAudioPlaybackComplete({ contentId });
      },
      onStop: () => {
        if (currentRadioPlaybackMatches(requestId, item.id, audioKey)) {
          radioPlayback = emptyRadioPlaybackState(requestId);
          radioPlaybackLoadingItemId = "";
        }
      },
      onError: () => {
        if (currentRadioPlaybackMatches(requestId, item.id, audioKey)) {
          radioPlayback = emptyRadioPlaybackState(requestId);
          radioPlaybackLoadingItemId = "";
        }
      }
    });

    if (!started && currentRadioPlaybackMatches(requestId, item.id, audioKey)) {
      radioPlayback = emptyRadioPlaybackState(requestId);
      radioPlaybackLoadingItemId = "";
    }

    return started;
  }

  function stopRadioPlayback(item?: RadioEpisodeItem) {
    const itemId = item?.id ?? radioPlayback.itemId;
    if (item && radioPlayback.itemId && radioPlayback.itemId !== item.id && radioPlaybackLoadingItemId !== item.id) {
      return;
    }

    radioPlaybackSerial += 1;
    radioPlaybackLoadingItemId = "";
    if (itemId) {
      stopAudioPlayback("radio_stop", radioPlaybackId(itemId));
    }
    radioPlayback = emptyRadioPlaybackState(radioPlaybackSerial);
  }

  function completeIncomingCall(callId: string) {
    const call = activeIncomingCall;

    if (!call || call.id !== callId) {
      return;
    }

    locallyCompletedIncomingCallIds = [...locallyCompletedIncomingCallIds, call.id];

    if (incomingCall?.id === call.id) {
      incomingCall = undefined;
    }

    if (uiState.sessionToken && !qaMode) {
      void recordBackgroundScenarioEvent(uiState.sessionToken, "incoming_call_completed", { callId: call.id }).then((result) => {
        if (!globalErrorVisible && result?.ok) {
          applyPlayerState(result.playerState);
          if (result.allClear) {
            showAllClear(result.allClear);
          }
        }
      });
    }

    shadeOpen = false;
    noiseVisible = false;
    window.clearTimeout(noiseTimer);

    closeApp();
  }

  function openBlockedCallHistory() {
    triggerNoise();
    trackEvent({ name: "locked_app", appId: "phone" });
  }

  function beginAppSession(app: AppCatalogItem, focusContentId = "") {
    shadeOpen = false;
    focusedContentId = focusContentId;
    focusedContentRequestId += 1;
    transientAssistantMessage = undefined;
    suppressedContentOpenKeys = [];

    if (!app.available) {
      triggerNoise();
      trackEvent({ name: "locked_app", appId: app.id });
      recordBlockedContentLink(app.id, focusContentId || app.id);
      return false;
    }

    activeAppId = app.id;
    trackEvent({ name: "app_open", appId: app.id });
    rememberAppOpened(app.id);
    pushCurrentPhoneRoute({
      kind: "app",
      appId: app.id,
      ...(focusContentId ? { contentId: focusContentId } : {})
    });

    return true;
  }

  function openApp(app: AppCatalogItem) {
    if (beginAppSession(app, uiState.lastContentByAppId[app.id] ?? "") && app.initialState && app.initialState !== "normal") {
      void handleContentOpen(app.id, app.id, { ignoreSuppression: true, skipRemember: true });
    }
  }

  async function openAppContent(app: AppCatalogItem, contentId: string) {
    shadeOpen = false;
    transientAssistantMessage = undefined;
    suppressedContentOpenKeys = [];

    if (!app.available) {
      triggerNoise();
      trackEvent({ name: "locked_app", appId: app.id });
      recordBlockedContentLink(app.id, contentId || app.id);
      return false;
    }

    const opened = await handleContentOpen(app.id, contentId, {
      ignoreSuppression: true,
      rememberAfterAccepted: true
    });

    if (opened) {
      focusOpenedContent(app.id, contentId);
    }

    return opened;
  }

  function recordBlockedContentLink(appId: AppId, attemptedContentId: string) {
    showBrokenLinkAssistantMessage(appId, attemptedContentId);

    if (!uiState.sessionToken) {
      return;
    }

    void recordScenarioEvent(uiState.sessionToken, "blocked_content_link_opened", {
      contentId: appId,
      fields: { attemptedContentId }
    })
      .then((result) => {
        if (result.ok) {
          applyPlayerState(result.playerState);
        } else {
          applyErrorPlayerState(result);
        }
      })
      .catch(() => {});
  }

  function showBrokenLinkAssistantMessage(appId: AppId, attemptedContentId: string) {
    const body =
      appId === "messages" && attemptedContentId
        ? INITIAL_MESSAGE_LINK_TUTORIAL_BODY
        : BROKEN_LINK_ASSISTANT_BODY;

    brokenLinkAssistantSerial += 1;
    showTransientAssistantMessage({
      id: `broken-link-${brokenLinkAssistantSerial}`,
      surface: appId,
      body,
      weight: 1,
      agentAction: "hi"
    });
  }

  function showAlbumMediaAddedAssistantMessage(surface: AssistantMessage["surface"]) {
    albumMediaAddedAssistantSerial += 1;
    showTransientAssistantMessage({
      id: `album-media-added-${albumMediaAddedAssistantSerial}`,
      surface,
      body: ALBUM_MEDIA_ADDED_ASSISTANT_BODY,
      weight: 1,
      agentAction: "hi"
    });
  }

  function hasNewAlbumContent(previousState: PlayerState | null, nextState: PlayerState) {
    if (!previousState) {
      return false;
    }

    const previousContentIds = repairedAlbumContentIds(previousState);
    return [...repairedAlbumContentIds(nextState)].some((contentId) => !previousContentIds.has(contentId));
  }

  function queueAlbumMediaAddedAssistant(appId: AppId, contentId: string | undefined, previousState: PlayerState | null, nextState: PlayerState) {
    if ((appId !== "messages" && appId !== "chat") || !contentId) {
      return;
    }

    if (!hasNewAlbumContent(previousState, nextState)) {
      return;
    }

    const key = albumMediaAddedAssistantKey(appId, contentId);
    if (!pendingAlbumMediaAddedAssistantKeys.includes(key)) {
      pendingAlbumMediaAddedAssistantKeys = [...pendingAlbumMediaAddedAssistantKeys, key];
    }
  }

  function consumeAlbumMediaAddedAssistant(appId: AppId, contentId: string | undefined) {
    if ((appId !== "messages" && appId !== "chat") || !contentId) {
      return false;
    }

    const key = albumMediaAddedAssistantKey(appId, contentId);
    if (!pendingAlbumMediaAddedAssistantKeys.includes(key)) {
      return false;
    }

    pendingAlbumMediaAddedAssistantKeys = pendingAlbumMediaAddedAssistantKeys.filter((item) => item !== key);
    return true;
  }

  function showTransientAssistantMessage(message: AssistantMessage) {
    transientAssistantMessage = message;
  }

  function repairedAlbumContentIds(state: PlayerState | null) {
    return new Set(
      (state?.contentStates ?? [])
        .filter((item) => item.appId === "photos" && (item.state === "repaired" || item.state === "unlocked"))
        .map((item) => item.contentId)
    );
  }

  async function handleContentOpen(
    appId: AppId,
    contentId: string | undefined,
    options: {
      ignoreSuppression?: boolean;
      rememberAfterAccepted?: boolean;
      skipRemember?: boolean;
      clearDisplayedTalkAfterApply?: boolean;
      throwOnRetryableError?: boolean;
      historyRestore?: boolean;
    } = {}
  ) {
    if (!contentId) {
      return false;
    }

    if (!options.rememberAfterAccepted && !options.skipRemember) {
      rememberAppContent(appId, contentId);
    }

    const key = contentOpenKey(appId, contentId);
    if (!options.ignoreSuppression && suppressedContentOpenKeys.includes(key)) {
      suppressedContentOpenKeys = suppressedContentOpenKeys.filter((item) => item !== key);
      if (options.rememberAfterAccepted && !options.skipRemember) {
        rememberAppContent(appId, contentId);
      }
      syncPhoneHistoryContent(appId, contentId);
      return true;
    }

    if (qaMode || !uiState.sessionToken) {
      if (options.rememberAfterAccepted && !options.skipRemember) {
        rememberAppContent(appId, contentId);
      }
      syncPhoneHistoryContent(appId, contentId);
      return true;
    }

    if (inFlightContentOpenKeys.includes(key)) {
      return false;
    }

    const contentNavigationId = options.historyRestore
      ? phoneHistoryNavigationId
      : ++phoneHistoryNavigationId;
    const sessionToken = uiState.sessionToken;
    inFlightContentOpenKeys = [...inFlightContentOpenKeys, key];
    const talkReadCursors = pendingTalkReadCursorPayload();
    const previousState = playerState;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await recordContentOpened(sessionToken, { appId, contentId }, talkReadCursors);
          if (result.ok) {
            clearSyncedTalkReadCursors(talkReadCursors);
            const currentState = playerState;
            const applied = applyPlayerState(result.playerState);
            const acceptedOlderResponse = Boolean(
              !applied
              && currentState
              && result.playerState.stateVersion < currentState.stateVersion
              && result.playerState.revision === currentState.revision
              && result.playerState.clientRevision === currentState.clientRevision
            );
            if (!applied && !acceptedOlderResponse) {
              return false;
            }
            if (options.clearDisplayedTalkAfterApply) {
              displayedTalkTarget = null;
            }
            if (options.rememberAfterAccepted && !options.skipRemember) {
              rememberAppContent(appId, contentId);
            }
            if (applied) {
              queueAlbumMediaAddedAssistant(appId, contentId, previousState, result.playerState);
            }
            if (contentNavigationId === phoneHistoryNavigationId) {
              syncPhoneHistoryContent(appId, contentId);
            }
            return true;
          }

          applyErrorPlayerState(result);
          const retryable = result.retryable === true || result.error === "conflict";
          if (!retryable) {
            return false;
          }
          if (options.throwOnRetryableError) {
            throw new Error(`content_open_failed:${result.error}`);
          }
          if (attempt >= PROGRESSION_RETRY_DELAYS_MS.length) {
            showGlobalError(result.error, { supportCode: "AP-STATE" });
            return false;
          }
        } catch (error) {
          if (options.throwOnRetryableError) {
            throw error;
          }
          if (attempt >= PROGRESSION_RETRY_DELAYS_MS.length) {
            showGlobalError(error, { supportCode: "AP-STATE" });
            return false;
          }
        }

        if (uiState.sessionToken !== sessionToken || uiState.locked) {
          return false;
        }
        await waitMs(PROGRESSION_RETRY_DELAYS_MS[attempt]);
      }
    } finally {
      inFlightContentOpenKeys = inFlightContentOpenKeys.filter((item) => item !== key);
    }
  }

  async function handleContentMediaObserved(appId: AppId, contentId: string | undefined) {
    if (!contentId || qaMode || !uiState.sessionToken) {
      return;
    }

    const mediaKey = mediaObservedKey(appId, contentId);
    if (inFlightMediaObservedKeys.includes(mediaKey)) {
      return;
    }

    inFlightMediaObservedKeys = [...inFlightMediaObservedKeys, mediaKey];
    const previousState = playerState;
    try {
      const result = await recordContentMediaObserved(uiState.sessionToken, { appId, contentId });
      if (result.ok) {
        if (applyPlayerState(result.playerState)) {
          queueAlbumMediaAddedAssistant(appId, contentId, previousState, result.playerState);
        }
      } else {
        applyErrorPlayerState(result);
      }
    } catch {
      // 開きっぱなしスレッドのアルバム同期補助なので、通信失敗時は次回の変化か再開封に委ねる。
    } finally {
      inFlightMediaObservedKeys = inFlightMediaObservedKeys.filter((item) => item !== mediaKey);
    }
  }

  function handleVisibleMediaObserved(appId: AppId, contentId: string | undefined) {
    if (consumeAlbumMediaAddedAssistant(appId, contentId)) {
      showAlbumMediaAddedAssistantMessage(appId);
    }
  }

  function setComposerPhotoDraftActive(appId: AppId, active: boolean) {
    if (appId !== "messages" && appId !== "chat") {
      return;
    }

    composerPhotoDraftByApp = { ...composerPhotoDraftByApp, [appId]: active };

    if (!active) {
      return;
    }

    const nextState = clearAlbumAssistantStateForPhotoDraft({
      appId,
      pendingKeys: pendingAlbumMediaAddedAssistantKeys,
      transientMessage: transientAssistantMessage
    });
    pendingAlbumMediaAddedAssistantKeys = nextState.pendingKeys;
    transientAssistantMessage = nextState.transientMessage;
  }

  function handleTalkRead(talkId: string, messageId: string) {
    if (!talkId || !messageId || !localTalkReadCursorCanAdvance(talkId, messageId)) {
      return;
    }

    persist({
      localTalkReadCursors: {
        ...uiState.localTalkReadCursors,
        [talkId]: messageId
      },
      pendingTalkReadCursors:
        qaMode || !uiState.sessionToken
          ? uiState.pendingTalkReadCursors
          : {
              ...uiState.pendingTalkReadCursors,
              [talkId]: messageId
            }
    });
  }

  function handleDisplayedTalkChange(appId: DisplayedTalkTarget["appId"], contentId: string) {
    if (!contentId) {
      if (displayedTalkTarget?.appId === appId) {
        displayedTalkTarget = null;
      }
      return;
    }

    if (displayedTalkTarget?.appId === appId && displayedTalkTarget.contentId === contentId) {
      return;
    }

    displayedTalkTarget = { appId, contentId };
  }

  function openNotification(notificationId: string) {
    const notification = deviceState.notifications.find((item) => item.id === notificationId);

    if (!notification) {
      return;
    }

    if (notificationToast?.id === notificationId) {
      notificationToast = null;
    }
    openNotificationApp(notification);
  }

  function openNotificationApp(notification: NotificationItem) {
    const app = apps.find((item) => item.id === notification.appId);

    if (!app) {
      return;
    }

    if (uiState.locked) {
      pendingNotificationOpen = { appId: app.id, contentId: notification.targetContentId };
      return;
    }

    void openAppContent(app, notification.targetContentId);
  }

  function closeApp() {
    const returningHome = activeAppId !== null || shadeOpen;
    clearPhoneRoute();

    if (returningHome) {
      pushCurrentPhoneRoute({ kind: "home" });
      refreshPlayerStateOnHomeIfStale();
    }
  }

  async function handleSearchAgentSearch(query: string, requestId: string) {
    if (!uiState.sessionToken) {
      return { ok: false, matched: false, body: "検索できませんでした。", results: [] } satisfies SearchAgentSearchResponse;
    }

    const result = await searchAgentSearch(uiState.sessionToken, query, requestId);

    if (!result.ok) {
      applyErrorPlayerState(result);
      return { ok: false, matched: false, body: "検索できませんでした。", results: [] } satisfies SearchAgentSearchResponse;
    }

    if (result.playerState) {
      applyPlayerState(result.playerState);
    }

    return { ok: true, matched: result.matched, body: result.body, results: result.results } satisfies SearchAgentSearchResponse;
  }

  async function handleOpenSearchAgentResult(result: SearchAgentSearchResult) {
    if (!uiState.sessionToken) {
      return false;
    }

    const shouldShowRepairMessage = result.repairable === true && !isSearchAgentResultAlreadyRepaired(result);
    const opened = await handleContentOpen(result.appId, result.contentId, {
      ignoreSuppression: true,
      rememberAfterAccepted: true,
      clearDisplayedTalkAfterApply: displayedTalkTarget !== null && displayedTalkTarget.appId !== result.appId
    });

    if (opened) {
      focusOpenedContent(result.appId, result.contentId);
      if (shouldShowRepairMessage) {
        showTransientAssistantMessage({
          id: `repair-${result.contentId}`,
          surface: result.appId as AssistantMessage["surface"],
          body: "アプリから開けるようにデータを修復しておいたよ。",
          weight: 1,
          agentAction: "hi"
        });
      }
    }
    return opened;
  }

  function isSearchAgentResultAlreadyRepaired(result: SearchAgentSearchResult) {
    if (result.targetKind === "app" || result.contentId === result.appId) {
      const app = apps.find((item) => item.id === result.appId);
      return Boolean(app?.available && app.corrupted !== true);
    }

    return Boolean(
      playerState?.contentStates.some(
        (item) => item.contentId === result.contentId && (item.state === "repaired" || item.state === "unlocked")
      )
    );
  }

  function currentTalk(talkId: string) {
    return playerState?.talks.find((talk) => talk.talkId === talkId) ?? null;
  }

  function currentTurnKey(talkId: string) {
    return currentTalk(talkId)?.turnKey ?? "";
  }

  function currentCanPost(talkId: string) {
    return currentTalk(talkId)?.canPost ?? false;
  }

  function messagesForTalkKind(state: PlayerState | null, kind: TalkKind) {
    if (!state) {
      return [];
    }
    return kind === "sms" ? state.smsMessages : state.chatMessages;
  }

  function newOtherTalkMessages(kind: TalkKind, talkId: string, nextState: PlayerState, previousState: PlayerState | null) {
    const previousIds = new Set(
      messagesForTalkKind(previousState, kind)
        .filter((message) => message.talkId === talkId)
        .map((message) => message.id)
    );

    return messagesForTalkKind(nextState, kind).filter(
      (message) => message.talkId === talkId && message.sender === "other" && !previousIds.has(message.id)
    );
  }

  function startPendingTalkSend(kind: TalkKind, talkId: string, message: string) {
    pendingTalkMessageCounter += 1;
    const pendingMessage: GameOverTalkMessage = {
      kind,
      id: `${kind}_pending_${pendingTalkMessageCounter}`,
      talkId,
      sender: "owner",
      senderName: kind === "chat" ? "あなた" : null,
      body: message,
      attachment: null,
      sentAt: new Date().toISOString()
    };

    pendingTalkMessages = [
      ...pendingTalkMessages.filter((item) => !(item.kind === kind && item.talkId === talkId)),
      pendingMessage
    ];
    replyDelayAnchorsByThread = {
      ...replyDelayAnchorsByThread,
      [talkId]: {
        waiting: true
      }
    };
  }

  function clearReplyDelayAnchor(talkId: string) {
    if (!(talkId in replyDelayAnchorsByThread)) {
      return;
    }

    const { [talkId]: _removed, ...nextAnchors } = replyDelayAnchorsByThread;
    replyDelayAnchorsByThread = nextAnchors;
  }

  function finishPendingTalkSend(kind: TalkKind, talkId: string) {
    pendingTalkMessages = pendingTalkMessages.filter((item) => !(item.kind === kind && item.talkId === talkId));
    clearReplyDelayAnchor(talkId);
  }

  function postEnabledMap(talkIds: readonly string[]) {
    const visibleTalkIds = new Set(talkIds);
    return Object.fromEntries(
      (playerState?.talks ?? [])
        .filter((talk) => visibleTalkIds.has(talk.talkId))
        .map((talk) => [talk.talkId, talk.canPost])
    );
  }

  function shareTargetsForTalks(
    messageThreads: MessageThread[],
    chatThreads: ChatAppThread[],
    messagePostEnabled: Record<string, boolean>,
    chatPostEnabled: Record<string, boolean>,
    chatAuthGate: DeviceState["chatAuthGate"]
  ): TalkShareTarget[] {
    const messageTargets = messageThreads
      .filter((thread) => !thread.corrupted && messagePostEnabled[thread.id] === true)
      .map((thread) => ({
        kind: "sms" as const,
        talkId: thread.id,
        label: thread.contactName,
        appLabel: "メッセージ"
      }));
    const chatTargets = chatAuthGate
      ? []
      : chatThreads
          .filter((thread) => !thread.corrupted && chatPostEnabled[thread.id] === true)
          .map((thread) => ({
            kind: "chat" as const,
            talkId: thread.id,
            label: thread.roomName,
            appLabel: "チャット"
          }));

    return [...messageTargets, ...chatTargets];
  }

  $: messagePostEnabledByThread = postEnabledMap(deviceState.messages.map((thread) => thread.id));
  $: chatPostEnabledByThread = postEnabledMap(deviceState.chatThreads.map((thread) => thread.id));
  $: sendablePhotos = deviceState.photos.filter((photo) => (photo.imageUrl || photo.audioUrl) && !photo.corrupted);
  $: radioShareTargets = shareTargetsForTalks(deviceState.messages, deviceState.chatThreads, messagePostEnabledByThread, chatPostEnabledByThread, deviceState.chatAuthGate);

  function gameOverMessageDelayMs(message: { delayMs?: number }) {
    if (typeof message.delayMs === "number" && Number.isFinite(message.delayMs)) {
      return Math.max(0, Math.min(message.delayMs, 8000));
    }
    return 0;
  }

  function gameOverOverlayDelayMs(messages: Array<{ sender: "owner" | "other"; delayMs?: number }>) {
    let totalMessageDelay = 0;

    for (const message of messages) {
      if (message.sender === "owner") {
        continue;
      }

      totalMessageDelay += gameOverMessageDelayMs(message);
    }

    return Math.max(
      GAME_OVER_OVERLAY_MIN_DELAY_MS,
      Math.min(GAME_OVER_OVERLAY_MAX_DELAY_MS, totalMessageDelay + GAME_OVER_OVERLAY_PADDING_MS)
    );
  }

  function waitMs(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function showGameOver(payload: GameOverPayload) {
    resetPhoneHistoryBoundary();
    gameOverReasonMessage = payload.reasonMessage ?? "";

    if (payload.kind === "form") {
      temporaryTalkMessages = [];
      gameOverTalk = null;
      gameOverVisible = false;
      gameOverReturning = false;
      appModalOpen = false;
      shadeOpen = false;
      notificationToast = null;

      window.clearTimeout(gameOverOverlayTimer);
      gameOverOverlayTimer = window.setTimeout(() => {
        if (!gameOverTalk) {
          gameOverVisible = true;
        }
      }, gameOverOverlayDelayMs([]));
      return;
    }

    const appId: AppId = payload.kind === "chat" ? "chat" : "messages";
    temporaryTalkMessages = payload.messages;
    gameOverTalk = { talkId: payload.talkId, kind: payload.kind };
    gameOverVisible = false;
    gameOverReturning = false;
    activeAppId = appId;
    focusedContentId = payload.talkId;
    focusedContentRequestId += 1;
    shadeOpen = false;
    appModalOpen = false;
    notificationToast = null;

    window.clearTimeout(gameOverOverlayTimer);
    gameOverOverlayTimer = window.setTimeout(() => {
      if (gameOverTalk?.talkId === payload.talkId) {
        gameOverVisible = true;
      }
    }, gameOverOverlayDelayMs(payload.messages));
  }

  async function dismissGameOver() {
    if (gameOverReturning) {
      return;
    }

    const source = gameOverTalk;
    gameOverReturning = true;
    window.clearTimeout(gameOverOverlayTimer);

    if (source) {
      activeAppId = source.kind === "chat" ? "chat" : "messages";
      focusedContentId = source.talkId;
      focusedContentRequestId += 1;
      appModalOpen = false;
      shadeOpen = false;
    }

    try {
      await Promise.all([
        !qaMode && uiState.sessionToken ? refreshPlayerState(uiState.sessionToken).catch(() => undefined) : Promise.resolve(),
        waitMs(GAME_OVER_RETURN_BLACKOUT_MIN_MS)
      ]);
    } finally {
      temporaryTalkMessages = [];
      gameOverVisible = false;
      gameOverTalk = null;
      gameOverReasonMessage = "";
      gameOverReturning = false;
      replaceCurrentPhoneRoute(currentPhoneRoute());
    }
  }

  function showAllClear(
    payload: AllClearPayload,
    options: { kind: TalkKind; talkId: string; previousState: PlayerState | null; nextState: PlayerState } | null = null
  ) {
    resetPhoneHistoryBoundary();
    allClearTarget = payload.target;
    allClearAutoplay = payload.autoplay;
    allClearVisible = false;
    allClearReturning = false;
    appModalOpen = false;
    shadeOpen = false;
    notificationToast = null;

    const messages = options
      ? newOtherTalkMessages(options.kind, options.talkId, options.nextState, options.previousState)
      : [];
    const delayMs = options ? gameOverOverlayDelayMs(messages) : gameOverOverlayDelayMs([]);

    window.clearTimeout(allClearOverlayTimer);
    allClearOverlayTimer = window.setTimeout(() => {
      if (allClearTarget?.appId === payload.target.appId && allClearTarget.contentId === payload.target.contentId) {
        allClearVisible = true;
      }
    }, delayMs);
  }

  function openAllClearTarget(target: AllClearPayload["target"], autoplay: boolean) {
    appModalOpen = false;
    notificationToast = null;
    noiseVisible = false;
    window.clearTimeout(noiseTimer);

    focusOpenedContent(target.appId, target.contentId);
    void handleContentOpen(target.appId, target.contentId, {
      ignoreSuppression: true,
      rememberAfterAccepted: true
    });

    if (autoplay && target.appId === "radio") {
      radioAutoplayContentId = target.contentId;
      radioAutoplayRequestId += 1;
    }
  }

  async function dismissAllClear() {
    if (allClearReturning) {
      return;
    }

    const target = allClearTarget;
    const autoplay = allClearAutoplay;
    allClearReturning = true;
    window.clearTimeout(allClearOverlayTimer);

    try {
      await Promise.all([
        !qaMode && uiState.sessionToken ? refreshPlayerState(uiState.sessionToken).catch(() => undefined) : Promise.resolve(),
        waitMs(ALL_CLEAR_RETURN_WHITEOUT_MIN_MS)
      ]);

      if (target) {
        openAllClearTarget(target, autoplay);
      }
    } finally {
      allClearVisible = false;
      allClearTarget = null;
      allClearAutoplay = false;
      allClearReturning = false;
    }
  }

  function talkContentId(kind: TalkKind, talkId: string, state: PlayerState | null = playerState) {
    const threads = state?.visibleDeviceState
      ? kind === "sms"
        ? (state.visibleDeviceState.messages ?? [])
        : (state.visibleDeviceState.chatThreads ?? [])
      : kind === "sms"
        ? deviceState.messages
        : deviceState.chatThreads;
    return threads.find((thread) => thread.id === talkId)?.contentId ?? talkId;
  }

  async function handleTalkSend(kind: TalkKind, talkId: string, message: string, cannotPostError: string) {
    if (!uiState.sessionToken) {
      return { ok: false, error: "送信できません。" };
    }
    if (!currentCanPost(talkId)) {
      return { ok: false, error: cannotPostError };
    }

    const turnKey = currentTurnKey(talkId);

    if (!turnKey) {
      return { ok: false, error: "送信状態を更新してください。" };
    }

    startPendingTalkSend(kind, talkId, message);

    let result: Awaited<ReturnType<typeof sendTalkMessage>>;
    const talkReadCursors = pendingTalkReadCursorPayload();
    try {
      result = await sendTalkMessage(uiState.sessionToken, talkId, turnKey, message, talkReadCursors);
    } catch {
      finishPendingTalkSend(kind, talkId);
      return { ok: false, error: "送信に失敗しました。" };
    }

    if (!result.ok) {
      finishPendingTalkSend(kind, talkId);
      applyErrorPlayerState(result);
      if (result.error === "llm_unavailable") {
        showGlobalError(result.error, { supportCode: "AP-LLM" });
      }
      return { ok: false, error: "送信に失敗しました。" };
    }

    clearSyncedTalkReadCursors(talkReadCursors);
    const previousState = playerState;
    finishPendingTalkSend(kind, talkId);

    const applied = applyPlayerState(result.playerState);
    if (result.stale) {
      return { ok: false, error: "会話が更新されました。内容を確認してもう一度送信してください。" };
    }
    if (result.gameOver) {
      showGameOver(result.gameOver);
    }
    if (applied) {
      queueAlbumMediaAddedAssistant(kind === "sms" ? "messages" : "chat", talkContentId(kind, talkId, result.playerState), previousState, result.playerState);
    }
    if (result.allClear) {
      showAllClear(result.allClear, {
        kind,
        talkId,
        previousState,
        nextState: result.playerState
      });
    }
    return { ok: true };
  }

  async function handleSmsSend(talkId: string, message: string) {
    return handleTalkSend("sms", talkId, message, "この会話には返信できません。");
  }

  async function handleContentUnlock(contentId: string, password: string) {
    if (!uiState.sessionToken) {
      return { ok: false, error: "ロック解除後に開けます。" };
    }

    let result: Awaited<ReturnType<typeof unlockContent>>;
    try {
      result = await unlockContent(uiState.sessionToken, contentId, password);
    } catch {
      return { ok: false, error: "開けませんでした。もう一度お試しください。" };
    }

    if (!result.ok) {
      applyErrorPlayerState(result);
      return { ok: false, error: "パスワードを確認してください。" };
    }

    applyPlayerState(result.playerState);
    return { ok: true };
  }

  async function handleChatAuthLinkRequest() {
    if (!uiState.sessionToken || !deviceState.chatAuthGate) {
      return { ok: false, error: "送信できません。" };
    }

    let result: Awaited<ReturnType<typeof recordScenarioEvent>>;
    try {
      result = await recordScenarioEvent(uiState.sessionToken, "chat_auth_link_requested");
    } catch {
      return { ok: false, error: "送信に失敗しました。" };
    }

    if (!result.ok) {
      applyErrorPlayerState(result);
      return { ok: false, error: "送信に失敗しました。" };
    }

    applyPlayerState(result.playerState);
    return { ok: true };
  }

  async function handleMessageLinkOpen(talkId: string, messageRef: string, segmentIndex: number) {
    if (!uiState.sessionToken) {
      return;
    }

    const backLinkSource = activeAppId === "messages" || activeAppId === "chat" ? activeAppId : null;
    let result: Awaited<ReturnType<typeof openMessageLink>>;
    try {
      result = await openMessageLink(uiState.sessionToken, { talkId, messageRef, segmentIndex });
    } catch {
      return;
    }
    if (!result.ok) {
      applyErrorPlayerState(result);
      return;
    }

    if (!applyPlayerState(result.playerState)) {
      return;
    }
    const targetAppId = result.target.appId;
    focusOpenedContent(targetAppId, result.target.contentId);
    showTalkBackLink(backLinkSource, targetAppId);
    notificationToast = null;
    void handleContentOpen(targetAppId, result.target.contentId, { ignoreSuppression: true, rememberAfterAccepted: true });
  }

  async function handleChatSend(talkId: string, message: string) {
    return handleTalkSend("chat", talkId, message, "このルームには投稿できません。");
  }

  function handleRadioShareContent(target: TalkShareTarget, content: { contentId: string; title: string }) {
    const appId: AppId = target.kind === "chat" ? "chat" : "messages";
    shareDraftRequestId += 1;
    pendingShareDraft = {
      requestId: shareDraftRequestId,
      kind: target.kind,
      talkId: target.talkId,
      appId: "radio",
      contentId: content.contentId,
      title: content.title
    };
    activeAppId = appId;
    focusedContentId = target.talkId;
    focusedContentRequestId += 1;
    shadeOpen = false;
    appModalOpen = false;
    notificationToast = null;
    transientAssistantMessage = undefined;
    trackEvent({ name: "app_open", appId });
    rememberAppOpened(appId);
    pushCurrentPhoneRoute({ kind: "app", appId, contentId: target.talkId });
  }

  function consumePendingShareDraft(requestId: number) {
    if (pendingShareDraft?.requestId === requestId) {
      pendingShareDraft = null;
    }
  }

  function handleOpenSharedContent(appId: AppId, contentId: string) {
    const backLinkSource = activeAppId === "messages" || activeAppId === "chat" ? activeAppId : null;
    focusOpenedContent(appId, contentId);
    showTalkBackLink(backLinkSource, appId);
    void handleContentOpen(appId, contentId, {
      ignoreSuppression: true,
      rememberAfterAccepted: true
    });
  }

  function openRadioPlayback() {
    const radioApp = apps.find((app) => app.id === "radio");
    if (!radioApp) {
      return;
    }
    if (radioPlayback.active) {
      radioPlaybackFocusRequestId += 1;
    }
    if (activeAppId !== "radio") {
      openApp(radioApp);
    }
  }

  function albumMediaContentId(attachment: MessageAttachment | undefined) {
    if (!attachment || (attachment.kind !== "image" && attachment.kind !== "audio")) {
      return "";
    }
    if (!apps.some((app) => app.id === "photos" && app.available)) {
      return "";
    }

    const photo = attachment.attachmentId ? sendablePhotos.find((item) => item.attachmentId === attachment.attachmentId) : undefined;

    return photo ? photo.contentId ?? photo.id : "";
  }

  function handleOpenAlbumMedia(attachment: MessageAttachment | undefined) {
    const contentId = albumMediaContentId(attachment);
    if (!contentId) {
      return;
    }

    const photosApp = apps.find((app) => app.id === "photos");
    if (!photosApp?.available) {
      triggerNoise();
      return;
    }

    const backLinkSource = activeAppId === "messages" || activeAppId === "chat" ? activeAppId : null;
    void openAppContent(photosApp, contentId).then((opened) => {
      if (opened) {
        showTalkBackLink(backLinkSource, "photos");
      }
    });
  }

  function radioFormSubmitErrorMessage(error: string | undefined) {
    if (error === "message_rejected") {
      return "不適切な内容のため送信できません。";
    }
    if (error === "not_ready") {
      return "まだ投稿できません。";
    }
    return "投稿の送信に失敗しました。";
  }

  async function handleSubmitRadioForm(formId: string, fields: Record<string, string>) {
    if (!uiState.sessionToken) {
      return { ok: false, error: "unauthorized", message: "投稿を送信できません。" };
    }

    const result = await submitRadioForm(uiState.sessionToken, formId, fields);

    if (!result.ok) {
      applyErrorPlayerState(result);
      return { ok: false, error: result.error, message: radioFormSubmitErrorMessage(result.error) };
    }

    applyPlayerState(result.playerState);
    if (result.gameOver) {
      showGameOver(result.gameOver);
    }
    return { ok: true, gameOver: Boolean(result.gameOver) };
  }

</script>

<div class="stage" class:game-stage={!outOfGameVisible} class:out-game-stage={outOfGameVisible}>
  {#if globalErrorVisible}
    <div class="out-game-dialog out-game-dialog--error">
      <GlobalErrorScreen message={globalErrorMessage} supportCode={globalErrorSupportCode} />
    </div>
  {:else if holdScreenRequired}
    <div class="out-game-dialog out-game-dialog--hold">
      <StartConfirmationScreen variant="hold" />
    </div>
  {:else if startConfirmationRequired}
    <div class="out-game-dialog">
      <StartConfirmationScreen browserMode={playerMode === "browser"} onConfirm={confirmStart} />
    </div>
  {:else}
    {#snippet phone(presentation: PhonePresentation)}
      <PhoneStage mode={presentation.mode} let:frameOnly>
        <PhoneFrame
          {deviceState}
          {frameOnly}
          osName={String(projectConstants["device.os_name"] ?? "XStoryPhone")}
          searchAgentName={String(projectConstants["search_agent.name"] ?? "ナビ")}
          assistantVisible={!uiState.locked && !appModalOpen && !assistantHiddenByComposerPhotoDraft(activeAppId, composerPhotoDraftByApp)}
          assistantSurfaceKey={assistantSurfaceKey}
          assistantSurfaceMessage={assistantSurfaceMessage}
          assistantSurfaceMessageMode={assistantSurfaceMessageMode}
          {shadeOpen}
          homeButtonVisible={!uiState.locked && (activeAppId !== null || shadeOpen)}
          backLinkLabel={visibleTalkBackLink ? TALK_BACK_LINK_LABELS[visibleTalkBackLink.sourceAppId] : ""}
          radioPlaybackActive={!uiState.locked && radioPlayback.active}
          searchAgentPeeking={!uiState.locked}
          searchAgentMessages={playerState?.searchAgentMessages ?? []}
          contentStates={playerState?.contentStates ?? []}
          incomingCall={activeIncomingCall}
          wallpaperUrl={deviceState.wallpaperUrl ?? ""}
          wallpaperVisible={uiState.locked || activeAppId === null}
          onHome={closeApp}
          onBackLink={openTalkBackLink}
          onOpenRadioPlayback={openRadioPlayback}
          onToggleShade={() => (shadeOpen = !shadeOpen)}
          onCompleteCall={completeIncomingCall}
          onSearchAgentSearch={handleSearchAgentSearch}
          onOpenSearchAgentResult={handleOpenSearchAgentResult}
        >
      {#key routeKey}
        <div class="route-surface">
          {#if uiState.locked}
            <LockScreen
              {deviceState}
              {pinLength}
              browserMode={playerMode === "browser"}
              onUnlock={unlockDevice}
              onOpenNotification={openNotification}
            />
          {:else if activeApp?.id === "phone"}
            <PhoneApp
              callLogs={deviceState.callLogs}
              focusContentId={focusedContentId}
              focusContentRequestId={focusedContentRequestId}
              onContentOpen={(contentId) => void handleContentOpen("phone", contentId)}
              onNoise={openBlockedCallHistory}
            />
          {:else if activeApp?.id === "messages"}
          <MessagesApp
            threads={deviceState.messages}
            photos={sendablePhotos}
            focusContentId={focusedContentId}
            focusContentRequestId={focusedContentRequestId}
            delayMemoryKey={localPlayerMemoryKey(playerMode, uiState.sessionToken)}
            initialDateLabel={TALK_INITIAL_DATE_LABEL}
            initialShareDraft={pendingShareDraft?.kind === "sms" ? pendingShareDraft : null}
            postEnabledByThread={messagePostEnabledByThread}
            replyDelayAnchorsByThread={replyDelayAnchorsByThread}
            onSend={handleSmsSend}
            onInitialShareDraftConsumed={consumePendingShareDraft}
            onOpenSharedContent={handleOpenSharedContent}
            albumMediaContentId={albumMediaContentId}
            onOpenAlbumMedia={handleOpenAlbumMedia}
            onUnlockAttachment={handleContentUnlock}
            onOpenMessageLink={handleMessageLinkOpen}
            onContentOpen={(contentId) => void handleContentOpen("messages", contentId)}
            onMediaObserved={(contentId) => void handleContentMediaObserved("messages", contentId)}
            onVisibleMediaObserved={(contentId) => handleVisibleMediaObserved("messages", contentId)}
            onRead={(talkId, messageId) => void handleTalkRead(talkId, messageId)}
            onDisplayedThreadChange={(contentId) => handleDisplayedTalkChange("messages", contentId)}
            onBlockedContentOpen={(contentId) => recordBlockedContentLink("messages", contentId)}
            onNoise={triggerNoise}
            onPickerOpenChange={(open) => (appModalOpen = open)}
            onPhotoDraftChange={(active) => setComposerPhotoDraftActive("messages", active)}
          />
          {:else if activeApp?.id === "photos"}
            <AlbumApp
              photos={deviceState.photos}
              focusContentId={focusedContentId}
              focusContentRequestId={focusedContentRequestId}
              onContentOpen={(contentId) => void handleContentOpen("photos", contentId)}
              onBlockedContentOpen={(contentId) => recordBlockedContentLink("photos", contentId)}
            />
          {:else if activeApp?.id === "notes"}
            <NotesApp
              notes={deviceState.notes}
              focusContentId={focusedContentId}
              focusContentRequestId={focusedContentRequestId}
              onContentOpen={(contentId) => void handleContentOpen("notes", contentId)}
              onBlockedContentOpen={(contentId) => recordBlockedContentLink("notes", contentId)}
            />
          {:else if activeApp?.id === "calendar"}
            <CalendarApp
              events={deviceState.calendarEvents}
              focusContentId={focusedContentId}
              focusContentRequestId={focusedContentRequestId}
              onContentOpen={(contentId) => void handleContentOpen("calendar", contentId)}
              onNoise={triggerNoise}
            />
          {:else if activeApp?.id === "radio"}
            <RadioApp
              items={deviceState.radioItems}
              focusContentId={focusedContentId}
              focusContentRequestId={focusedContentRequestId}
              autoplayContentId={radioAutoplayContentId}
              autoplayRequestId={radioAutoplayRequestId}
              shareTargets={radioShareTargets}
              playbackItemId={radioPlayback.active ? radioPlayback.itemId : ""}
              playbackAudioKey={radioPlayback.audioKey}
              playbackCurrentMs={radioPlayback.currentMs}
              playbackDurationMs={radioPlayback.durationMs}
              playbackLoadingItemId={radioPlaybackLoadingItemId}
              playbackRequestId={radioPlayback.requestId}
              playbackFocusRequestId={radioPlaybackFocusRequestId}
              onStartPlayback={startRadioPlayback}
              onStopPlayback={stopRadioPlayback}
              onShareContent={handleRadioShareContent}
              onSubmitRadioForm={handleSubmitRadioForm}
              onContentOpen={(contentId) => void handleContentOpen("radio", contentId)}
              onBlockedContentOpen={(contentId) => recordBlockedContentLink("radio", contentId)}
              onNoise={triggerNoise}
              onModalOpenChange={(open) => (appModalOpen = open)}
            />
          {:else if activeApp?.id === "chat"}
          <ChatApp
            threads={deviceState.chatThreads}
            authGate={deviceState.chatAuthGate}
            photos={sendablePhotos}
            initialDateLabel={TALK_INITIAL_DATE_LABEL}
            focusContentId={focusedContentId}
            focusContentRequestId={focusedContentRequestId}
            delayMemoryKey={localPlayerMemoryKey(playerMode, uiState.sessionToken)}
            initialShareDraft={pendingShareDraft?.kind === "chat" ? pendingShareDraft : null}
            postEnabledByThread={chatPostEnabledByThread}
            replyDelayAnchorsByThread={replyDelayAnchorsByThread}
            onSend={handleChatSend}
            onInitialShareDraftConsumed={consumePendingShareDraft}
            onOpenSharedContent={handleOpenSharedContent}
            albumMediaContentId={albumMediaContentId}
            onOpenAlbumMedia={handleOpenAlbumMedia}
            onAuthLinkRequest={handleChatAuthLinkRequest}
            onOpenMessageLink={handleMessageLinkOpen}
            onContentOpen={(contentId) => void handleContentOpen("chat", contentId)}
            onMediaObserved={(contentId) => void handleContentMediaObserved("chat", contentId)}
            onVisibleMediaObserved={(contentId) => handleVisibleMediaObserved("chat", contentId)}
            onRead={(talkId, messageId) => void handleTalkRead(talkId, messageId)}
            onDisplayedThreadChange={(contentId) => handleDisplayedTalkChange("chat", contentId)}
            onBlockedContentOpen={(contentId) => recordBlockedContentLink("chat", contentId)}
            onNoise={triggerNoise}
            onPickerOpenChange={(open) => (appModalOpen = open)}
            onPhotoDraftChange={(active) => setComposerPhotoDraftActive("chat", active)}
            />
          {:else}
            <HomeScreen {apps} {deviceState} {unreadAppIds} onOpenApp={openApp} onOpenNotification={openNotification} />
          {/if}
        </div>
      {/key}

      <NotificationShade
        notifications={deviceState.notifications}
        batteryLevel={deviceState.batteryLevel}
        signalLabel={deviceState.signalLabel}
        open={shadeOpen && !uiState.locked}
        onLock={lockDevice}
        onOpenNotification={openNotification}
      />
      <svelte:fragment slot="overlay">
        {#if notificationToast}
          <NotificationToast notification={notificationToast} onOpen={() => openNotification(notificationToast?.id ?? "")} />
        {/if}
        <NoiseOverlay visible={noiseVisible} />
      </svelte:fragment>
        </PhoneFrame>
      </PhoneStage>
    {/snippet}
    <svelte:boundary onerror={handleProjectStageError}>
      <ProjectStage context={projectStageContext} {phone} />
    </svelte:boundary>
    <GameOverOverlay
      visible={gameOverVisible}
      returning={gameOverReturning}
      titleText="GAME OVER"
      reasonMessage={gameOverReasonMessage}
      onDismiss={() => void dismissGameOver()}
    />
    <AllClearOverlay
      visible={allClearVisible}
      returning={allClearReturning}
      titleText="ALL CLEAR"
      label={ALL_CLEAR_LABEL}
      ariaLabel={allClearReturning ? "オールクリア後の移動中" : "オールクリア後に移動"}
      onDismiss={() => void dismissAllClear()}
    />
  {/if}
</div>

<style>
  .stage {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    padding: 12px;
  }

  .game-stage {
    display: block;
    padding: 0;
    background:
      linear-gradient(118deg, rgba(80, 211, 190, 0.1) 0%, transparent 31%),
      linear-gradient(298deg, rgba(230, 151, 83, 0.09) 0%, transparent 34%),
      linear-gradient(135deg, #081016 0%, #10131a 46%, #1b1713 100%);
  }

  .route-surface {
    min-height: 0;
    height: 100%;
    animation: route-in 110ms ease-out both;
  }

  @keyframes route-in {
    from {
      transform: translateY(4px) scale(0.998);
    }

    to {
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 520px) {
    .stage {
      padding: 0;
    }
  }
</style>
