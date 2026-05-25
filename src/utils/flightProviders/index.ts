import { aeroDataBoxProvider } from './aeroDataBoxProvider';
import { airLabsProvider } from './airLabsProvider';
import { fr24ApiProvider, fr24PublicProvider } from './fr24Provider';
import { staffMonitorProvider } from './staffMonitorProvider';
import { getFlightBestTs, mergeFlightLists, type FlightDirection } from '../flightScheduleAdapter';
import type { FlightProviderPreference } from '../flightProviderSettings';
import type {
  FlightSchedulePayload,
  FlightScheduleProvider,
  FlightScheduleProviderContext,
  FlightScheduleProviderId,
  FlightScheduleProviderResult,
  FlightScheduleProviderStatus,
} from './types';

export type {
  FlightSchedulePayload,
  FlightScheduleProviderContext,
  FlightScheduleProviderId,
  FlightScheduleProviderStatus,
} from './types';

const DEFAULT_PROVIDERS: FlightScheduleProvider[] = [
  fr24ApiProvider,
  staffMonitorProvider,
  aeroDataBoxProvider,
  fr24PublicProvider,
  airLabsProvider,
];

const PROVIDER_TIMEOUT_MS: Record<FlightScheduleProviderId, number> = {
  staffMonitor: 15_000,
  fr24Api: 10_000,
  aeroDataBox: 15_000,
  fr24Public: 10_000,
  airlabs: 12_000,
  cache: 0,
};

const PROVIDERS_BY_ID = {
  aeroDataBox: aeroDataBoxProvider,
  airlabs: airLabsProvider,
  staffMonitor: staffMonitorProvider,
} satisfies Record<Exclude<FlightProviderPreference, 'auto' | 'fr24'>, FlightScheduleProvider>;

type ProviderCooldown = {
  until: number;
  errorCode: string;
  message: string;
};

const PROVIDER_COOLDOWNS = new Map<string, ProviderCooldown>();
const COOLDOWNABLE_PROVIDERS = new Set<FlightScheduleProviderId>(['fr24Api', 'aeroDataBox', 'airlabs']);
const PROVIDER_COOLDOWN_MS: Partial<Record<string, number>> = {
  quota_or_limit: 30 * 60 * 1000,
  auth_failed: 30 * 60 * 1000,
};

export function getFlightScheduleProviders(
  preference: FlightProviderPreference = 'auto',
): FlightScheduleProvider[] {
  if (preference === 'auto') {
    return DEFAULT_PROVIDERS;
  }

  if (preference === 'fr24') {
    return [
      fr24ApiProvider,
      fr24PublicProvider,
      ...DEFAULT_PROVIDERS.filter(provider => provider.id !== fr24ApiProvider.id && provider.id !== fr24PublicProvider.id),
    ];
  }

  const preferred = PROVIDERS_BY_ID[preference];
  return [
    preferred,
    ...DEFAULT_PROVIDERS.filter(provider => provider.id !== preferred.id),
  ];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'unknown_error');
}

function errorCode(error: unknown): string {
  const message = errorMessage(error).toLowerCase();
  if (message.includes('provider_timeout')) return 'provider_timeout';
  if (message.includes('abort')) return 'provider_aborted';
  if (message.includes('api key') || message.includes('key non configurata')) return 'missing_api_key';
  if (/(?:http|status)[_\s-]?(401|403)\b/.test(message)
    || message.includes('unauthorized')
    || message.includes('forbidden')
    || message.includes('invalid api key')) {
    return 'auth_failed';
  }
  if (/(?:http|status)[_\s-]?(402|429)\b/.test(message)
    || message.includes('too many requests')
    || message.includes('rate')
    || message.includes('quota')
    || message.includes('limit')) {
    return 'quota_or_limit';
  }
  if (message.includes('http')) return 'http_error';
  return 'provider_error';
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function providerCredentialFingerprint(
  provider: FlightScheduleProvider,
  context: FlightScheduleProviderContext,
): string {
  if (provider.id === 'airlabs') return hashString(context.airLabsApiKey ?? 'no-key');
  if (provider.id === 'aeroDataBox') return hashString(`${context.aeroDataBoxGateway ?? 'apiMarket'}:${context.aeroDataBoxApiKey ?? 'no-key'}`);
  if (provider.id === 'fr24Api') return hashString(context.fr24ApiKey ?? 'no-key');
  return 'public';
}

function providerCooldownKey(
  provider: FlightScheduleProvider,
  context: FlightScheduleProviderContext,
): string | null {
  if (!COOLDOWNABLE_PROVIDERS.has(provider.id)) return null;
  return [
    provider.id,
    context.airportCode.toUpperCase(),
    providerCredentialFingerprint(provider, context),
  ].join(':');
}

function activeProviderCooldown(
  provider: FlightScheduleProvider,
  context: FlightScheduleProviderContext,
  nowMs: number,
): ProviderCooldown | null {
  const key = providerCooldownKey(provider, context);
  if (!key) return null;
  const cooldown = PROVIDER_COOLDOWNS.get(key);
  if (!cooldown) return null;
  if (cooldown.until <= nowMs) {
    PROVIDER_COOLDOWNS.delete(key);
    return null;
  }
  return cooldown;
}

function setProviderCooldown(
  provider: FlightScheduleProvider,
  context: FlightScheduleProviderContext,
  code: string,
  message: string,
  nowMs: number,
): number | undefined {
  const key = providerCooldownKey(provider, context);
  const durationMs = PROVIDER_COOLDOWN_MS[code];
  if (!key || !durationMs) return undefined;

  const until = nowMs + durationMs;
  PROVIDER_COOLDOWNS.set(key, {
    until,
    errorCode: code,
    message: message.slice(0, 180),
  });
  return until;
}

function clearProviderCooldown(provider: FlightScheduleProvider, context: FlightScheduleProviderContext): void {
  const key = providerCooldownKey(provider, context);
  if (key) PROVIDER_COOLDOWNS.delete(key);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatCooldownTime(until: number): string {
  const date = new Date(until);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameLocalDay(ts: number | undefined, day: Date): boolean {
  if (!ts) return false;
  const actual = new Date(ts * 1000);
  return actual.getFullYear() === day.getFullYear()
    && actual.getMonth() === day.getMonth()
    && actual.getDate() === day.getDate();
}

function hasFlightsOnDay(items: any[], direction: FlightDirection, day: Date): boolean {
  return items.some(item => isSameLocalDay(getFlightBestTs(item, direction), day));
}

function isScheduleBackedFlight(item: any): boolean {
  // FR24 API live positions are useful status overlays, not a complete airport schedule.
  return item?.flight?._source !== 'fr24_api';
}

function hasScheduleBackedFlightsOnDay(items: any[], direction: FlightDirection, day: Date): boolean {
  return items.some(item => isScheduleBackedFlight(item) && isSameLocalDay(getFlightBestTs(item, direction), day));
}

function countFlightsOnDay(items: any[], direction: FlightDirection, day: Date): number {
  return items.reduce(
    (count, item) => count + (isSameLocalDay(getFlightBestTs(item, direction), day) ? 1 : 0),
    0,
  );
}

function buildProviderCoverage(
  result: FlightScheduleProviderResult,
  now: Date,
): Pick<FlightScheduleProviderStatus, 'todayArrivals' | 'todayDepartures' | 'tomorrowArrivals' | 'tomorrowDepartures'> {
  const today = new Date(now);
  const tomorrow = addDays(today, 1);
  return {
    todayArrivals: countFlightsOnDay(result.allArrivals, 'arrival', today),
    todayDepartures: countFlightsOnDay(result.allDepartures, 'departure', today),
    tomorrowArrivals: countFlightsOnDay(result.allArrivals, 'arrival', tomorrow),
    tomorrowDepartures: countFlightsOnDay(result.allDepartures, 'departure', tomorrow),
  };
}

function hasDayCoverage(result: FlightScheduleProviderResult, day: Date): boolean {
  return hasFlightsOnDay(result.allArrivals, 'arrival', day)
    || hasFlightsOnDay(result.allDepartures, 'departure', day);
}

function hasScheduleBackedDayCoverage(result: FlightScheduleProviderResult, day: Date): boolean {
  return hasScheduleBackedFlightsOnDay(result.allArrivals, 'arrival', day)
    || hasScheduleBackedFlightsOnDay(result.allDepartures, 'departure', day);
}

function hasTomorrowListCoverage(result: FlightScheduleProviderResult, tomorrow: Date): boolean {
  return hasFlightsOnDay(result.allArrivals, 'arrival', tomorrow)
    && hasFlightsOnDay(result.allDepartures, 'departure', tomorrow);
}

function hasUsefulCoverage(result: FlightScheduleProviderResult): boolean {
  return result.allArrivals.length + result.allDepartures.length > 0;
}

function hasScheduleBackedTomorrowCoverage(result: FlightScheduleProviderResult, tomorrow: Date): boolean {
  return hasScheduleBackedFlightsOnDay(result.allArrivals, 'arrival', tomorrow)
    && hasScheduleBackedFlightsOnDay(result.allDepartures, 'departure', tomorrow);
}

function hasTodayAndTomorrowCoverage(result: FlightScheduleProviderResult, now: Date): boolean {
  const today = new Date(now);
  const tomorrow = addDays(today, 1);
  return hasScheduleBackedDayCoverage(result, today) && hasScheduleBackedTomorrowCoverage(result, tomorrow);
}

function providerTimeoutMs(provider: FlightScheduleProvider, context: FlightScheduleProviderContext): number {
  return context.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS[provider.id] ?? 12_000;
}

async function fetchProviderWithTimeout(
  provider: FlightScheduleProvider,
  context: FlightScheduleProviderContext,
): Promise<FlightScheduleProviderResult> {
  const timeoutMs = providerTimeoutMs(provider, context);
  if (timeoutMs <= 0 || typeof AbortController === 'undefined') {
    return provider.fetch(context);
  }

  const controller = new AbortController();
  let parentAbortHandler: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`PROVIDER_TIMEOUT_MS_${timeoutMs}`));
    }, timeoutMs);
  });

  if (context.signal?.aborted) {
    controller.abort();
    throw new Error('PROVIDER_PARENT_ABORTED');
  }

  if (context.signal) {
    parentAbortHandler = () => {
      controller.abort();
    };
    context.signal.addEventListener('abort', parentAbortHandler, { once: true });
  }

  try {
    return await Promise.race([
      provider.fetch({ ...context, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (context.signal && parentAbortHandler) {
      context.signal.removeEventListener('abort', parentAbortHandler);
    }
  }
}

function mergeProviderResults(
  previous: FlightScheduleProviderResult | null,
  next: FlightScheduleProviderResult,
): FlightScheduleProviderResult {
  if (!previous) {
    return next;
  }

  return {
    allArrivals: mergeFlightLists(previous.allArrivals, next.allArrivals, 'arrival'),
    allDepartures: mergeFlightLists(previous.allDepartures, next.allDepartures, 'departure'),
  };
}

function buildPayload(
  result: FlightScheduleProviderResult,
  source: FlightScheduleProviderId,
  sourceLabels: string[],
  diagnostics: FlightScheduleProviderStatus[],
): FlightSchedulePayload {
  return {
    ...result,
    source,
    sourceLabel: sourceLabels.join(' + '),
    fetchedAt: Date.now(),
    diagnostics,
  };
}

export async function fetchFlightScheduleFromProviders(
  context: FlightScheduleProviderContext,
  providers = DEFAULT_PROVIDERS,
): Promise<FlightSchedulePayload> {
  const diagnostics: FlightScheduleProviderStatus[] = [];
  const now = context.now ?? new Date();
  const nowMs = now.getTime();
  let aggregate: FlightScheduleProviderResult | null = null;
  let source: FlightScheduleProviderId | null = null;
  const sourceLabels: string[] = [];

  for (const provider of providers) {
    if (!provider.supports(context)) {
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'skipped',
        mode: 'full',
        contributed: false,
        message: provider.unavailableMessage?.(context) ?? `Unsupported airport ${context.airportCode}`,
      });
      continue;
    }

    const cooldown = activeProviderCooldown(provider, context, nowMs);
    if (cooldown) {
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'skipped',
        mode: 'full',
        contributed: false,
        errorCode: 'provider_cooldown',
        cooldownUntil: cooldown.until,
        message: `Cooldown attivo fino alle ${formatCooldownTime(cooldown.until)} dopo ${cooldown.errorCode}: ${cooldown.message}`,
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      const preference = context.preference ?? 'auto';
      const useAirLabsRoutesOnly = provider.id === 'airlabs'
        && aggregate !== null
        && hasScheduleBackedDayCoverage(aggregate, now);
      const useAeroDataBoxFutureOnly = provider.id === 'aeroDataBox'
        && aggregate !== null
        && hasScheduleBackedDayCoverage(aggregate, now);
      const mode = useAirLabsRoutesOnly ? 'routesOnly' : useAeroDataBoxFutureOnly ? 'futureOnly' : 'full';
      const messages: string[] = [];
      const providerContext: FlightScheduleProviderContext = {
        ...context,
        ...(useAirLabsRoutesOnly ? { airLabsMode: 'routesOnly' as const } : {}),
        ...(useAeroDataBoxFutureOnly ? { aeroDataBoxMode: 'futureOnly' as const } : {}),
      };
      if (useAeroDataBoxFutureOnly) {
        messages.push('Future-only mode per ridurre chiamate AeroDataBox');
      }
      if (useAirLabsRoutesOnly) {
        messages.push('Routes-only mode per ridurre consumo AirLabs');
      }

      const result = await fetchProviderWithTimeout(provider, providerContext);
      const durationMs = Date.now() - startedAt;
      const contributed = hasUsefulCoverage(result);
      clearProviderCooldown(provider, context);
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'success',
        mode,
        contributed,
        message: messages.length > 0 ? messages.join(' | ') : undefined,
        durationMs,
        arrivals: result.allArrivals.length,
        departures: result.allDepartures.length,
        ...buildProviderCoverage(result, now),
      });

      if (!contributed) {
        continue;
      }

      aggregate = mergeProviderResults(aggregate, result);
      source ??= provider.id;
      sourceLabels.push(provider.label);

      if (hasTodayAndTomorrowCoverage(aggregate, now)) {
        return buildPayload(aggregate, source, sourceLabels, diagnostics);
      }
    } catch (error) {
      const code = errorCode(error);
      const message = errorMessage(error);
      const cooldownUntil = setProviderCooldown(provider, context, code, message, nowMs);
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'failed',
        mode: 'full',
        contributed: false,
        errorCode: code,
        cooldownUntil,
        durationMs: Date.now() - startedAt,
        message: cooldownUntil
          ? `${message} · cooldown fino alle ${formatCooldownTime(cooldownUntil)}`
          : message,
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log(`[flightProviders] ${provider.id} failed:`, error);
      }
    }
  }

  if (aggregate && source) {
    return buildPayload(aggregate, source, sourceLabels, diagnostics);
  }

  const summary = diagnostics.map(item => `${item.label}: ${item.message ?? item.status}`).join(' | ');
  throw new Error(`NO_FLIGHT_PROVIDER_AVAILABLE ${summary}`);
}
