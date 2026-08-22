/*
 * GenWhisperer template: defensive eStage runtime integrations
 *
 * Use this file in generated eStage projects instead of calling window.estage*
 * methods directly from UI components. It provides:
 *   - exact feature detection
 *   - structured UNAVAILABLE / OFFLINE / FAILED outcomes
 *   - bounded retries for idempotent reads only
 *   - privacy-safe operational telemetry hooks
 *   - no browser-side credentials or raw provider errors
 */

export type EstageCapability =
  | "ai"
  | "connector"
  | "community"
  | "funnel"
  | "blog"
  | "localization"
  | "personalization";

export type CapabilityFailureCode = "UNAVAILABLE" | "OFFLINE" | "FAILED";

export type CapabilityResult<T> =
  | { ok: true; value: T; attempts: number }
  | {
      ok: false;
      code: CapabilityFailureCode;
      message: string;
      attempts: number;
    };

export type SafeTelemetryEvent = {
  capability: EstageCapability;
  operation: string;
  outcome: "succeeded" | "unavailable" | "offline" | "failed" | "retrying";
  attempts: number;
  durationMs: number;
  // This field is deliberately coarse. Never send prompts, files, connector
  // parameters, secrets, raw upstream bodies, or user-provided content.
  failureKind?: "network" | "unknown";
};

export type TelemetrySink = (event: SafeTelemetryEvent) => void;

type RetryMode = "never" | "idempotent-read";

type InvokeOptions<T> = {
  capability: EstageCapability;
  operation: string;
  available: boolean;
  run: () => Promise<T>;
  unavailableMessage: string;
  failureMessage: string;
  retryMode?: RetryMode;
  telemetry?: TelemetrySink;
};

const MAX_IDEMPOTENT_READ_ATTEMPTS = 2;
const RETRY_DELAY_MS = 350;

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function emit(
  telemetry: TelemetrySink | undefined,
  event: SafeTelemetryEvent,
): void {
  try {
    telemetry?.(event);
  } catch {
    // Observability must never break a visitor-facing capability.
  }
}

/**
 * Executes an optional eStage capability safely.
 *
 * Use retryMode: "idempotent-read" only for safe reads such as loading a
 * community feed or refreshing published blog data. Do not retry AI calls,
 * connector sends, uploads, lead capture, post creation, comments, or any
 * action that can charge credits or create an external side effect.
 */
export async function invokeEstageCapability<T>(
  options: InvokeOptions<T>,
): Promise<CapabilityResult<T>> {
  const startedAt = Date.now();
  const telemetryBase = {
    capability: options.capability,
    operation: options.operation,
  };

  if (!options.available) {
    emit(options.telemetry, {
      ...telemetryBase,
      outcome: "unavailable",
      attempts: 0,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: options.unavailableMessage,
      attempts: 0,
    };
  }

  if (isBrowserOffline()) {
    emit(options.telemetry, {
      ...telemetryBase,
      outcome: "offline",
      attempts: 0,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      code: "OFFLINE",
      message: "You appear to be offline. Reconnect and try again.",
      attempts: 0,
    };
  }

  const maxAttempts = options.retryMode === "idempotent-read"
    ? MAX_IDEMPOTENT_READ_ATTEMPTS
    : 1;

  for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
    try {
      const value = await options.run();
      emit(options.telemetry, {
        ...telemetryBase,
        outcome: "succeeded",
        attempts,
        durationMs: Date.now() - startedAt,
      });
      return { ok: true, value, attempts };
    } catch (error) {
      const canRetry =
        options.retryMode === "idempotent-read" &&
        attempts < maxAttempts &&
        isNetworkError(error);

      if (canRetry) {
        emit(options.telemetry, {
          ...telemetryBase,
          outcome: "retrying",
          attempts,
          durationMs: Date.now() - startedAt,
          failureKind: "network",
        });
        await wait(RETRY_DELAY_MS * attempts);
        continue;
      }

      emit(options.telemetry, {
        ...telemetryBase,
        outcome: "failed",
        attempts,
        durationMs: Date.now() - startedAt,
        failureKind: isNetworkError(error) ? "network" : "unknown",
      });
      return {
        ok: false,
        code: "FAILED",
        message: options.failureMessage,
        attempts,
      };
    }
  }

  // Defensive TypeScript exhaustiveness fallback.
  return {
    ok: false,
    code: "FAILED",
    message: options.failureMessage,
    attempts: maxAttempts,
  };
}

/**
 * Example: AI summaries are an optional, credit-consuming capability.
 * No automatic retry is used because an interrupted AI call can have consumed
 * project credits even when the browser did not receive a complete result.
 */
export function summarizeWithEstageAI(
  text: string,
  telemetry?: TelemetrySink,
): Promise<CapabilityResult<string>> {
  const available =
    typeof window !== "undefined" &&
    typeof window.estageAI?.summarize === "function";

  return invokeEstageCapability({
    capability: "ai",
    operation: "summarize",
    available,
    run: () => window.estageAI!.summarize(text),
    unavailableMessage: "AI summaries are not enabled for this site.",
    failureMessage: "The summary could not be created right now. Please try again later.",
    retryMode: "never",
    telemetry,
  });
}

/**
 * Example: Community feed retrieval is an idempotent read and can receive one
 * bounded retry for a transient browser/network interruption.
 */
export function loadCommunityThreads(
  options: { channel?: string; category?: string; cursor?: string },
  telemetry?: TelemetrySink,
): Promise<CapabilityResult<unknown>> {
  const available =
    typeof window !== "undefined" &&
    typeof window.estageCommunity?.fetchThreads === "function";

  return invokeEstageCapability({
    capability: "community",
    operation: "fetch_threads",
    available,
    run: () => window.estageCommunity!.fetchThreads(options),
    unavailableMessage: "Community discussions are not enabled for this site.",
    failureMessage: "Discussions could not be loaded right now. Please try again.",
    retryMode: "idempotent-read",
    telemetry,
  });
}

/**
 * Example: Funnel analytics is best effort. The caller must invoke this only
 * after the primary conversion action (such as lead submission) succeeds.
 */
export async function trackFunnelEvent(
  name: string,
  data: Record<string, string | number | boolean | null>,
  telemetry?: TelemetrySink,
): Promise<CapabilityResult<void>> {
  const available =
    typeof window !== "undefined" &&
    typeof window.estageFunnel?.trackEvent === "function";

  return invokeEstageCapability({
    capability: "funnel",
    operation: `track:${name}`,
    available,
    run: async () => {
      await window.estageFunnel!.trackEvent(name, data);
    },
    unavailableMessage: "Analytics are not enabled for this page.",
    failureMessage: "Analytics could not be recorded, but your action was completed.",
    retryMode: "never",
    telemetry,
  });
}

/*
 * Integration example in a UI component:
 *
 * const result = await summarizeWithEstageAI(articleText, sendSafeTelemetry);
 * if (!result.ok) {
 *   setInlineNotice(result.message);
 *   return;
 * }
 * setSummary(result.value);
 */

// Extend Window only with the methods that a generated project uses. The
// declarations below intentionally remain minimal and can be replaced by the
// platform's official types when those are available.
declare global {
  interface Window {
    estageAI?: {
      summarize(text: string): Promise<string>;
    };
    estageCommunity?: {
      fetchThreads(options: {
        channel?: string;
        category?: string;
        cursor?: string;
      }): Promise<unknown>;
    };
    estageFunnel?: {
      trackEvent(
        name: string,
        data?: Record<string, string | number | boolean | null>,
      ): Promise<void> | void;
    };
  }
}

export {};
