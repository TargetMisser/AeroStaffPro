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
  airLabsProvider,
  staffMonitorProvider,
  fr24ApiProvider,
  fr24PublicProvider,
];

const PROVIDERS_BY_ID = {
  airlabs: airLabsProvider,
  staffMonitor: staffMonitorProvider,
} satisfies Record<Exclude<FlightProviderPreference, 'auto' | 'fr24'>, FlightScheduleProvider>;

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

function hasTomorrowListCoverage(result: FlightScheduleProviderResult, tomorrow: Date): boolean {
  return hasFlightsOnDay(result.allArrivals, 'arrival', tomorrow)
    && hasFlightsOnDay(result.allDepartures, 'departure', tomorrow);
}

function hasUsefulCoverage(result: FlightScheduleProviderResult): boolean {
  return result.allArrivals.length + result.allDepartures.length > 0;
}

function hasTodayAndTomorrowCoverage(result: FlightScheduleProviderResult, now: Date): boolean {
  const today = new Date(now);
  const tomorrow = addDays(today, 1);
  return hasDayCoverage(result, today) && hasTomorrowListCoverage(result, tomorrow);
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
  let aggregate: FlightScheduleProviderResult | null = null;
  let source: FlightScheduleProviderId | null = null;
  const sourceLabels: string[] = [];

  for (const provider of providers) {
    if (!provider.supports(context)) {
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'skipped',
        message: provider.unavailableMessage?.(context) ?? `Unsupported airport ${context.airportCode}`,
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await provider.fetch(context);
      const durationMs = Date.now() - startedAt;
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'success',
        durationMs,
        arrivals: result.allArrivals.length,
        departures: result.allDepartures.length,
        ...buildProviderCoverage(result, now),
      });

      if (!hasUsefulCoverage(result)) {
        continue;
      }

      aggregate = mergeProviderResults(aggregate, result);
      source ??= provider.id;
      sourceLabels.push(provider.label);

      if (hasTodayAndTomorrowCoverage(aggregate, now)) {
        return buildPayload(aggregate, source, sourceLabels, diagnostics);
      }
    } catch (error) {
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        message: errorMessage(error),
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[flightProviders] ${provider.id} failed:`, error);
      }
    }
  }

  if (aggregate && source) {
    return buildPayload(aggregate, source, sourceLabels, diagnostics);
  }

  const summary = diagnostics.map(item => `${item.label}: ${item.message ?? item.status}`).join(' | ');
  throw new Error(`NO_FLIGHT_PROVIDER_AVAILABLE ${summary}`);
}
