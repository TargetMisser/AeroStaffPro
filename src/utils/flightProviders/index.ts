import { aeroDataBoxProvider } from './aeroDataBoxProvider';
import { airLabsProvider } from './airLabsProvider';
import { fr24ApiProvider, fr24PublicProvider } from './fr24Provider';
import { staffMonitorProvider } from './staffMonitorProvider';
import { getFlightBestTs, getFlightScheduledTs, mergeFlightLists, type FlightDirection } from '../flightScheduleAdapter';
import type { FlightProviderPreference } from '../flightProviderSettings';
import { getErrorMessage } from '../errorUtils';
import { devLog } from '../devLog';
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
  // Not a real schedule provider — only used for the FlightScreen live ETA
  // diagnostic entry, which never goes through runProviders().
  liveEta: 0,
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

function errorCode(error: unknown): string {
  const message = getErrorMessage(error).toLowerCase();
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

function getFlightServiceDayTs(item: any, direction: FlightDirection): number | undefined {
  return getFlightScheduledTs(item, direction) ?? getFlightBestTs(item, direction);
}

function hasFlightsOnDay(items: any[], direction: FlightDirection, day: Date): boolean {
  return items.some(item => isSameLocalDay(getFlightServiceDayTs(item, direction), day));
}

function isScheduleBackedFlight(item: any): boolean {
  // FR24 API live positions are useful status overlays, not a complete airport schedule.
  return item?.flight?._source !== 'fr24_api';
}

function hasScheduleBackedFlightsOnDay(items: any[], direction: FlightDirection, day: Date): boolean {
  return items.some(item => isScheduleBackedFlight(item) && isSameLocalDay(getFlightServiceDayTs(item, direction), day));
}

function countFlightsOnDay(items: any[], direction: FlightDirection, day: Date): number {
  return items.reduce(
    (count, item) => count + (isSameLocalDay(getFlightServiceDayTs(item, direction), day) ? 1 : 0),
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
  // Reject cancellation before starting network work or a timeout promise.
  if (context.signal?.aborted) {
    throw new Error('PROVIDER_PARENT_ABORTED');
  }

  const timeoutMs = providerTimeoutMs(provider, context);
  if (timeoutMs <= 0 || typeof AbortController === 'undefined') {
    return provider.fetch(context);
  }

  const controller = new AbortController();
  let parentAbortHandler: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`PROVIDER_TIMEOUT_MS_${timeoutMs}`));
      controller.abort();
    }, timeoutMs);
  });

  let rejectParentAbort: ((reason: Error) => void) | undefined;
  const parentAbortPromise = new Promise<never>((_, reject) => {
    rejectParentAbort = reject;
  });

  if (context.signal) {
    parentAbortHandler = () => {
      rejectParentAbort?.(new Error('PROVIDER_PARENT_ABORTED'));
      controller.abort();
    };
    context.signal.addEventListener('abort', parentAbortHandler, { once: true });
  }

  try {
    return await Promise.race([
      provider.fetch({ ...context, signal: controller.signal }),
      timeoutPromise,
      parentAbortPromise,
    ]);
  } finally {
    // A timeout/parent abort must also stop the provider's underlying fetches,
    // not just let Promise.race return while network work continues detached.
    controller.abort();
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
    allArrivals: mergeFlightLists(previous.allArrivals, next.allArrivals, 'arrival', Date.now(), mergeProviderFlightItems),
    allDepartures: mergeFlightLists(previous.allDepartures, next.allDepartures, 'departure', Date.now(), mergeProviderFlightItems),
  };
}

function mergeProviderFlightItems(previousItem: any, nextItem: any, direction: FlightDirection): any {
  const previousFlight = previousItem?.flight ?? {};
  const nextFlight = nextItem?.flight ?? {};
  const previousTime = previousFlight.time ?? {};
  const nextTime = nextFlight.time ?? {};
  const timeField = direction === 'arrival' ? 'arrival' : 'departure';
  const previousHasAuthoritativeEta = direction === 'arrival'
    && previousFlight._etaSource === 'fr24_api'
    && typeof previousTime.estimated?.[timeField] === 'number';
  const nextHasAuthoritativeEta = direction === 'arrival'
    && nextFlight._etaSource === 'fr24_api'
    && typeof nextTime.estimated?.[timeField] === 'number';
  const estimated = {
    ...(previousTime.estimated ?? {}),
    ...(nextTime.estimated ?? {}),
  };

  if (previousHasAuthoritativeEta && !nextHasAuthoritativeEta) {
    estimated[timeField] = previousTime.estimated[timeField];
  }

  return {
    ...previousItem,
    ...nextItem,
    flight: {
      ...previousFlight,
      ...nextFlight,
      identification: {
        ...(previousFlight.identification ?? {}),
        ...(nextFlight.identification ?? {}),
      },
      airline: {
        ...(previousFlight.airline ?? {}),
        ...(nextFlight.airline ?? {}),
        code: {
          ...(previousFlight.airline?.code ?? {}),
          ...(nextFlight.airline?.code ?? {}),
        },
      },
      aircraft: {
        ...(previousFlight.aircraft ?? {}),
        ...(nextFlight.aircraft ?? {}),
      },
      airport: {
        ...(previousFlight.airport ?? {}),
        ...(nextFlight.airport ?? {}),
      },
      time: {
        ...previousTime,
        ...nextTime,
        scheduled: {
          ...(previousTime.scheduled ?? {}),
          ...(nextTime.scheduled ?? {}),
        },
        estimated,
        real: {
          ...(previousTime.real ?? {}),
          ...(nextTime.real ?? {}),
        },
      },
      _operational: {
        ...(previousFlight._operational ?? {}),
        ...(nextFlight._operational ?? {}),
      },
      _etaSource: direction === 'arrival'
        ? nextHasAuthoritativeEta
          ? 'fr24_api'
          : previousHasAuthoritativeEta
            ? 'fr24_api'
            : nextFlight._etaSource ?? previousFlight._etaSource
        : undefined,
    },
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

  type ProviderAttempt = {
    provider: FlightScheduleProvider;
    diagnostic: FlightScheduleProviderStatus;
    result?: FlightScheduleProviderResult;
  };

  const runProviderAttempt = async (
    provider: FlightScheduleProvider,
    currentAggregate: FlightScheduleProviderResult | null,
  ): Promise<ProviderAttempt> => {
    if (!provider.supports(context)) {
      return {
        provider,
        diagnostic: {
          provider: provider.id,
          label: provider.label,
          status: 'skipped',
          mode: 'full',
          contributed: false,
          message: provider.unavailableMessage?.(context) ?? `Unsupported airport ${context.airportCode}`,
        },
      };
    }

    const cooldown = activeProviderCooldown(provider, context, nowMs);
    if (cooldown) {
      return {
        provider,
        diagnostic: {
          provider: provider.id,
          label: provider.label,
          status: 'skipped',
          mode: 'full',
          contributed: false,
          errorCode: 'provider_cooldown',
          cooldownUntil: cooldown.until,
          message: `Cooldown attivo fino alle ${formatCooldownTime(cooldown.until)} dopo ${cooldown.errorCode}: ${cooldown.message}`,
        },
      };
    }

    const startedAt = Date.now();
    try {
      const useAirLabsRoutesOnly = provider.id === 'airlabs'
        && currentAggregate !== null
        && hasScheduleBackedDayCoverage(currentAggregate, now);
      const useAeroDataBoxFutureOnly = provider.id === 'aeroDataBox'
        && currentAggregate !== null
        && hasScheduleBackedDayCoverage(currentAggregate, now);
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
      return {
        provider,
        result,
        diagnostic: {
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
        },
      };
    } catch (error) {
      const code = errorCode(error);
      const message = getErrorMessage(error);
      const cooldownUntil = setProviderCooldown(provider, context, code, message, nowMs);
      devLog(`[flightProviders] ${provider.id} failed:`, error);
      return {
        provider,
        diagnostic: {
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
        },
      };
    }
  };

  const applyProviderAttempt = (attempt: ProviderAttempt): boolean => {
    diagnostics.push(attempt.diagnostic);
    if (!attempt.result || !attempt.diagnostic.contributed) return false;

    aggregate = mergeProviderResults(aggregate, attempt.result);
    source ??= attempt.provider.id;
    sourceLabels.push(attempt.provider.label);
    return hasTodayAndTomorrowCoverage(aggregate, now);
  };

  const preference = context.preference ?? 'auto';
  // Auto starts AeroDataBox with the live/local providers so a stalled source
  // cannot consume the parent refresh deadline before schedule coverage starts.
  // The explicit FR24 preference has its own wave: API and public fallback must
  // both start immediately, while Promise.all preserves their provider order
  // when the results are applied below.
  const autoCoreIds = new Set<FlightScheduleProviderId>(['fr24Api', 'staffMonitor', 'aeroDataBox']);
  const preferredFr24Ids = new Set<FlightScheduleProviderId>(['fr24Api', 'fr24Public']);
  const coreProviders = preference === 'auto'
    ? providers.filter(provider => autoCoreIds.has(provider.id))
    : preference === 'fr24'
      ? providers.filter(provider => preferredFr24Ids.has(provider.id))
      : [];
  const useParallelCore = coreProviders.length >= 2;
  const attemptedCoreIds = new Set<FlightScheduleProviderId>();

  if (useParallelCore) {
    const attempts = await Promise.all(
      coreProviders.map(provider => runProviderAttempt(provider, null)),
    );
    for (const attempt of attempts) {
      attemptedCoreIds.add(attempt.provider.id);
      applyProviderAttempt(attempt);
    }
    if (aggregate && source && hasTodayAndTomorrowCoverage(aggregate, now)) {
      return buildPayload(aggregate, source, sourceLabels, diagnostics);
    }
  }

  for (const provider of providers) {
    if (attemptedCoreIds.has(provider.id)) continue;
    const attempt = await runProviderAttempt(provider, aggregate);
    if (applyProviderAttempt(attempt) && aggregate && source) {
      return buildPayload(aggregate, source, sourceLabels, diagnostics);
    }
  }

  if (aggregate && source) {
    return buildPayload(aggregate, source, sourceLabels, diagnostics);
  }

  const summary = diagnostics.map(item => `${item.label}: ${item.message ?? item.status}`).join(' | ');
  throw new Error(`NO_FLIGHT_PROVIDER_AVAILABLE ${summary}`);
}
