import type { AirportInfo } from '../airportSettings';

export type FlightScheduleProviderId = 'aeroDataBox' | 'airlabs' | 'fr24Api' | 'fr24Public' | 'staffMonitor' | 'cache';

export type FlightScheduleProviderStatus = {
  provider: FlightScheduleProviderId;
  label: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
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
  airLabsApiKey?: string | null;
  fr24ApiKey?: string | null;
  airLabsMode?: 'full' | 'routesOnly';
  signal?: AbortSignal;
  now?: Date;
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
