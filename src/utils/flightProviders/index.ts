import { airLabsProvider } from './airLabsProvider';
import { fr24ApiProvider, fr24PublicProvider } from './fr24Provider';
import { staffMonitorProvider } from './staffMonitorProvider';
import type { FlightProviderPreference } from '../flightProviderSettings';
import type {
  FlightSchedulePayload,
  FlightScheduleProvider,
  FlightScheduleProviderContext,
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

export async function fetchFlightScheduleFromProviders(
  context: FlightScheduleProviderContext,
  providers = DEFAULT_PROVIDERS,
): Promise<FlightSchedulePayload> {
  const diagnostics: FlightScheduleProviderStatus[] = [];

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
      });

      return {
        ...result,
        source: provider.id,
        sourceLabel: provider.label,
        fetchedAt: Date.now(),
        diagnostics,
      };
    } catch (error) {
      diagnostics.push({
        provider: provider.id,
        label: provider.label,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        message: errorMessage(error),
      });
      if (__DEV__) console.warn(`[flightProviders] ${provider.id} failed:`, error);
    }
  }

  const summary = diagnostics.map(item => `${item.label}: ${item.message ?? item.status}`).join(' | ');
  throw new Error(`NO_FLIGHT_PROVIDER_AVAILABLE ${summary}`);
}
