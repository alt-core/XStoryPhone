import type { AppId } from "../scenario-runtime/types";
import { demoProjectConstantsGenerated as projectConstants } from "../generated/demoProjectConstants.generated";

type AnalyticsEvent =
  | { name: "app_open"; appId: AppId }
  | { name: "locked_app"; appId: AppId }
  | { name: "lock_device"; appId?: AppId }
  | { name: "logout"; source: "url_suffix" }
  | { name: "unlock_device" };

type ClientErrorKind = "mount_error" | "unhandled_rejection" | "window_error";
type ClientErrorInput = {
  kind: ClientErrorKind;
  reason: unknown;
  filename?: string;
  lineno?: number;
  colno?: number;
};

type GtagCommand = "config" | "consent" | "event" | "js" | "set";
type Gtag = (command: GtagCommand, target: string | Date, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GA4_MEASUREMENT_ID = import.meta.env.VITE_XSTORYPHONE_GA4_MEASUREMENT_ID ?? "";
const CLIENT_VERSION = String(projectConstants["client.runtime_revision"] ?? "");
const GTAG_SRC_ID = "xstoryphone-google-tag";
const MAX_ERROR_REPORTS_PER_PAGE = 20;
const reportedErrorKeys = new Set<string>();

function analyticsEnabled() {
  return /^G-[A-Z0-9]+$/i.test(GA4_MEASUREMENT_ID);
}

function ensureGoogleTag() {
  if (!analyticsEnabled()) {
    return undefined;
  }

  window.dataLayer ??= [];
  window.gtag ??= function gtag(...args) {
    window.dataLayer?.push(args);
  };

  if (!document.getElementById(GTAG_SRC_ID)) {
    const script = document.createElement("script");
    script.id = GTAG_SRC_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`;
    document.head.appendChild(script);

    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"
    });
    window.gtag("js", new Date());
    window.gtag("config", GA4_MEASUREMENT_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
  }

  return window.gtag;
}

function eventParams(event: AnalyticsEvent) {
  switch (event.name) {
    case "app_open":
    case "locked_app":
      return { app_id: event.appId };
    case "lock_device":
      return event.appId ? { app_id: event.appId } : {};
    case "logout":
      return { source: event.source };
    case "unlock_device":
      return {};
  }
}

function errorObject(reason: unknown) {
  if (reason instanceof Error) {
    return reason;
  }

  return undefined;
}

function errorName(reason: unknown) {
  const error = errorObject(reason);
  if (error?.name) {
    return error.name.slice(0, 80);
  }
  return typeof reason;
}

function errorMessage(reason: unknown) {
  const error = errorObject(reason);
  if (typeof error?.message === "string") {
    return error.message;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return "";
}

function errorStack(reason: unknown) {
  const error = errorObject(reason);
  return typeof error?.stack === "string" ? error.stack : "";
}

function shortHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeFrame(frame: string) {
  return frame
    .trim()
    .replace(/https?:\/\/[^)\s]+\/assets\//g, "/assets/")
    .replace(/["'`][^"'`]{1,120}["'`]/g, "\"...\"")
    .slice(0, 180);
}

function sanitizeFileName(filename: string) {
  try {
    const url = new URL(filename, window.location.origin);
    return url.pathname.slice(0, 180);
  } catch {
    return sanitizeFrame(filename);
  }
}

function stackTopFrame(stack: string) {
  const lines = stack.split("\n").map((line) => line.trim()).filter(Boolean);
  return sanitizeFrame(lines.find((line) => line.startsWith("at ")) ?? lines[1] ?? "");
}

function pathForAnalytics() {
  return window.location.pathname.slice(0, 120);
}

function errorReportKey(params: Record<string, unknown>) {
  return [
    params.error_kind,
    params.error_name,
    params.message_hash,
    params.stack_hash,
    params.error_line,
    params.error_column
  ].join(":");
}

export function trackEvent(event: AnalyticsEvent) {
  const gtag = ensureGoogleTag();
  if (!gtag) {
    return;
  }

  gtag("event", `xstoryphone_${event.name}`, {
    ...eventParams(event),
    client_version: CLIENT_VERSION
  });
}

export function trackClientError(input: ClientErrorInput) {
  const gtag = ensureGoogleTag();
  if (!gtag) {
    return;
  }

  const message = errorMessage(input.reason);
  const stack = errorStack(input.reason);
  const params: Record<string, unknown> = {
    error_kind: input.kind,
    error_name: errorName(input.reason),
    message_hash: message ? shortHash(message) : "",
    stack_hash: stack ? shortHash(stack) : "",
    stack_top: stackTopFrame(stack),
    error_file: input.filename ? sanitizeFileName(input.filename) : "",
    error_line: typeof input.lineno === "number" ? input.lineno : undefined,
    error_column: typeof input.colno === "number" ? input.colno : undefined,
    path: pathForAnalytics(),
    visibility_state: document.visibilityState,
    client_version: CLIENT_VERSION
  };
  const key = errorReportKey(params);
  if (reportedErrorKeys.has(key) || reportedErrorKeys.size >= MAX_ERROR_REPORTS_PER_PAGE) {
    return;
  }

  reportedErrorKeys.add(key);
  gtag("event", "xstoryphone_client_error", params);
}
