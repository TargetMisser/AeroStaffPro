import type { AirportInfo } from '../airportSettings';
import type { FlightProviderPreference } from '../flightProviderSettings';

export type FlightScheduleProviderId = 'aeroDataBox' | 'airlabs' | 'fr24Api' | 'fr24Public' | 'staffMonitor' | 'cache' | 'liveEta';

export type FlightScheduleProviderStatus = {
  provider: FlightScheduleProviderId;
  label: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
  mode?: 'full' | 'futureOnly' | 'routesOnly' | 'dailyMerge' | 'fallback';
  contributed?: boolean;
  cacheMerged?: boolean;
  errorCode?: string;
  cooldownUntil?: number;
  durationMs?: number;
  arrivals?: number;
  departures?: number;
  todayArrivals?: number;
  todayDepartures?: number;
  tomorrowArrivals?: number;
  tomorrowDepartures?: number;
};

export type FlightScheduleProviderContext = {
  airportCode: string;
  airport: AirportInfo;
  aeroDataBoxApiKey?: string | null;
  aeroDataBoxGateway?: 'apiMarket' | 'rapidApi';
  aeroDataBoxMode?: 'full' | 'futureOnly';
  airLabsApiKey?: string | null;
  fr24ApiKey?: string | null;
  airLabsMode?: 'full' | 'routesOnly';
  providerTimeoutMs?: number;
  signal?: AbortSignal;
  now?: Date;
  preference?: FlightProviderPreference;
};

export type FlightScheduleProviderResult = {
  allArrivals: any[];
  allDepartures: any[];
};

export type FlightSchedulePayload = FlightScheduleProviderResult & {
  source: FlightScheduleProviderId;
  sourceLabel: string;
  fetchedAt: number;
  diagnostics: FlightScheduleProviderStatus[];
};

export type FlightScheduleProvider = {
  id: FlightScheduleProviderId;
  label: string;
  supports: (context: FlightScheduleProviderContext) => boolean;
  unavailableMessage?: (context: FlightScheduleProviderContext) => string;
  fetch: (context: FlightScheduleProviderContext) => Promise<FlightScheduleProviderResult>;
};
