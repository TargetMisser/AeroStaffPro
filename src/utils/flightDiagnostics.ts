import type { TranslationKey } from '../i18n/translations';
import type { FlightScheduleProviderStatus } from './flightProviders';

export type FlightListTab = 'arrivals' | 'departures';

export type TomorrowEmptyReason =
  | 'filtered'
  | 'provider_failed'
  | 'provider_skipped'
  | 'provider_empty'
  | 'missing_future_support';

const FUTURE_PROVIDER_IDS = new Set(['aeroDataBox', 'airlabs', 'cache']);

function hasDayCounts(item: FlightScheduleProviderStatus): boolean {
  return typeof item.todayArrivals === 'number'
    || typeof item.todayDepartures === 'number'
    || typeof item.tomorrowArrivals === 'number'
    || typeof item.tomorrowDepartures === 'number';
}

function hasTomorrowCount(item: FlightScheduleProviderStatus, activeTab: FlightListTab): boolean {
  return activeTab === 'arrivals'
    ? (item.tomorrowArrivals ?? 0) > 0
    : (item.tomorrowDepartures ?? 0) > 0;
}

function isFutureRelevant(item: FlightScheduleProviderStatus): boolean {
  return FUTURE_PROVIDER_IDS.has(item.provider)
    || typeof item.tomorrowArrivals === 'number'
    || typeof item.tomorrowDepartures === 'number';
}

export function formatProviderDiagnostic(item: FlightScheduleProviderStatus): string {
  const mode = item.mode ? ` · ${item.mode}` : '';
  const contribution = typeof item.contributed === 'boolean'
    ? ` · ${item.contributed ? 'usato' : 'non usato'}`
    : '';
  const cache = item.cacheMerged === true
    ? ' · cache fusa'
    : item.mode === 'fallback'
      ? ' · fallback cache'
      : '';
  const timing = typeof item.durationMs === 'number' ? ` · ${item.durationMs}ms` : '';

  if (item.status === 'success') {
    if (!hasDayCounts(item)) {
      return `${item.label}: A ${item.arrivals ?? 0} / P ${item.departures ?? 0}${mode}${contribution}${cache}${timing}`;
    }
    return `${item.label}: oggi A${item.todayArrivals ?? 0}/P${item.todayDepartures ?? 0}, domani A${item.tomorrowArrivals ?? 0}/P${item.tomorrowDepartures ?? 0}${mode}${contribution}${cache}${timing}`;
  }

  const status = item.status === 'skipped' ? 'saltato' : 'errore';
  const code = item.errorCode ? ` [${item.errorCode}]` : '';
  const message = item.message ? ` - ${item.message.slice(0, 120)}` : '';
  return `${item.label}: ${status}${code}${mode}${contribution}${timing}${message}`;
}

export function getTomorrowEmptyReason({
  rawDayCount,
  activeTab,
  diagnostics = [],
}: {
  rawDayCount: number;
  activeTab: FlightListTab;
  diagnostics?: FlightScheduleProviderStatus[];
}): TomorrowEmptyReason {
  if (rawDayCount > 0) {
    return 'filtered';
  }

  const futureDiagnostics = diagnostics.filter(isFutureRelevant);
  if (futureDiagnostics.some(item => item.status === 'failed')) {
    return 'provider_failed';
  }
  if (futureDiagnostics.some(item => item.status === 'skipped')) {
    return 'provider_skipped';
  }
  if (futureDiagnostics.some(item => item.status === 'success' && !hasTomorrowCount(item, activeTab))) {
    return 'provider_empty';
  }

  return 'missing_future_support';
}

export function getTomorrowEmptyReasonTranslationKey(reason: TomorrowEmptyReason): TranslationKey {
  switch (reason) {
    case 'filtered':
      return 'flightTomorrowReasonFiltered';
    case 'provider_failed':
      return 'flightTomorrowReasonProviderFailed';
    case 'provider_skipped':
      return 'flightTomorrowReasonProviderSkipped';
    case 'provider_empty':
      return 'flightTomorrowReasonProviderEmpty';
    case 'missing_future_support':
    default:
      return 'flightTomorrowReasonMissingFutureSupport';
  }
}

export function formatFlightCacheAge(timestamp: number | undefined, nowMs = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return 'n/d';
  }
  const ageMs = Math.max(0, nowMs - timestamp);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'ora';
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  return `${Math.floor(hours / 24)} g fa`;
}
