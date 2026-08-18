import { NativeModules } from 'react-native';
import { getErrorMessage, getErrorStack } from './errorUtils';

export type RuntimeReport = {
  type: string;
  message: string;
  timestamp: string;
  thread?: string;
  stack?: string;
  appVersion?: string;
  device?: string;
  androidVersion?: string;
  startupPending?: boolean;
  metadata?: Record<string, string>;
};

export type RuntimeExitInfo = {
  timestamp: number;
  reasonCode: number;
  reasonLabel: string;
  status: number;
  importance: number;
  processName?: string | null;
  description?: string | null;
  pssKb: number;
  rssKb: number;
  traceAvailable: boolean;
};

export type RuntimeDiagnosticsState = {
  appVersion: string;
  device: string;
  androidVersion: string;
  startupPending: boolean;
  startupStartedAt?: number;
  startupCompletedAt?: number;
  logFilePath?: string;
  lastExitInfo?: RuntimeExitInfo | null;
  lastReport: RuntimeReport | null;
};

type RuntimeDiagnosticsNativeModule = {
  initialDiagnosticsJson?: string;
  getRuntimeDiagnostics?: () => Promise<string>;
  clearLastReport?: () => Promise<boolean>;
  markStartupCompleted?: () => Promise<boolean>;
  recordJsError?: (
    message: string,
    stack: string,
    isFatal: boolean,
    source: string,
  ) => Promise<boolean>;
};

type ErrorUtilsShape = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

const runtimeModule = NativeModules.RuntimeDiagnostics as RuntimeDiagnosticsNativeModule | undefined;

function fallbackState(): RuntimeDiagnosticsState {
  return {
    appVersion: '',
    device: '',
    androidVersion: '',
    startupPending: false,
    lastReport: null,
  };
}

function parseDiagnostics(payload?: string | null): RuntimeDiagnosticsState {
  if (!payload) {
    return fallbackState();
  }

  try {
    const parsed = JSON.parse(payload) as Partial<RuntimeDiagnosticsState>;
    return {
      ...fallbackState(),
      ...parsed,
      lastExitInfo: parsed.lastExitInfo ?? null,
      lastReport: parsed.lastReport ?? null,
    };
  } catch {
    return fallbackState();
  }
}

const initialRuntimeDiagnostics = parseDiagnostics(runtimeModule?.initialDiagnosticsJson);
let jsCrashHandlerInstalled = false;

function normalizeError(error: unknown): { message: string; stack: string } {
  return {
    message: getErrorMessage(error, 'Unknown error'),
    stack: getErrorStack(error),
  };
}

export async function getRuntimeDiagnostics(): Promise<RuntimeDiagnosticsState> {
  if (!runtimeModule?.getRuntimeDiagnostics) {
    return initialRuntimeDiagnostics;
  }

  try {
    const payload = await runtimeModule.getRuntimeDiagnostics();
    return parseDiagnostics(payload);
  } catch {
    return initialRuntimeDiagnostics;
  }
}

export async function clearLastRuntimeReport(): Promise<void> {
  await runtimeModule?.clearLastReport?.();
}

export async function markRuntimeStartupCompleted(): Promise<void> {
  await runtimeModule?.markStartupCompleted?.();
}

export async function recordRuntimeError(
  error: unknown,
  source: string,
  isFatal = false,
): Promise<void> {
  if (!runtimeModule?.recordJsError) {
    return;
  }

  const normalized = normalizeError(error);
  await runtimeModule.recordJsError(
    normalized.message,
    normalized.stack,
    isFatal,
    source,
  );
}

export function installGlobalCrashHandler(): void {
  if (jsCrashHandlerInstalled) {
    return;
  }

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  const defaultHandler = errorUtils?.getGlobalHandler?.();
  if (!errorUtils?.setGlobalHandler || !defaultHandler) {
    return;
  }

  jsCrashHandlerInstalled = true;
  errorUtils.setGlobalHandler((error, isFatal) => {
    void recordRuntimeError(error, 'global', Boolean(isFatal))
      .catch(() => {})
      .finally(() => {
        defaultHandler(error, isFatal);
      });
  });
}
