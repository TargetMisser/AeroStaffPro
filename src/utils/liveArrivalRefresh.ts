import type { AirportInfo } from './airportSettings';
import { getCanonicalFlightNumberIdentity } from './flightScheduleAdapter';
import { applyFlightLiveUpdates, isLiveEtaFresh } from './flightLiveUpdates';
import { fetchFr24ArrivalUpdates } from './flightProviders/fr24Provider';
import { applyLiveArrivalEtas, fetchAdsbAircraft } from './liveArrivalEta';

export const LIVE_ARRIVAL_REFRESH_MS = 30_000;
const FR24_REFRESH_MS = 60_000;
const MAX_TRACKED_ARRIVALS = 6;

export function selectLiveArrivals(arrivals: any[], nowMs = Date.now()): any[] {
  const reference = (item: any) => item.flight?.time?.estimated?.arrival ?? item.flight?.time?.scheduled?.arrival;
  return arrivals.filter(item => {
    const eta = reference(item);
    return !item.flight?.time?.real?.arrival && !/cancel|divert/i.test(item.flight?.status?.text ?? '')
      && typeof eta === 'number' && eta * 1000 >= nowMs - 3 * 60 * 60 * 1000
      && eta * 1000 <= nowMs + 90 * 60 * 1000;
  }).sort((a, b) => Math.abs(reference(a) * 1000 - nowMs) - Math.abs(reference(b) * 1000 - nowMs))
    .slice(0, MAX_TRACKED_ARRIVALS);
}

export function createLiveArrivalRefresher() {
  let lastApiAttempt = 0;
  let cooldownUntil = 0;
  let credential = '';
  let previousAirport = '';
  return async ({ arrivals, airport, apiKey, signal, onProgress }: {
    arrivals: any[]; airport: AirportInfo; apiKey: string | null;
    signal: AbortSignal; onProgress: (items: any[]) => void;
  }): Promise<void> => {
    const targets = selectLiveArrivals(arrivals);
    if (!targets.length || signal.aborted) return;
    if (credential !== (apiKey ?? '') || previousAirport !== airport.code) {
      credential = apiKey ?? '';
      previousAirport = airport.code;
      lastApiAttempt = 0;
      cooldownUntil = 0;
    }
    let current = targets;
    const publish = (items: any[]) => {
      if (signal.aborted) return;
      current = items;
      onProgress(items);
    };
    const tasks: Promise<void>[] = [];
    const now = Date.now();
    const needsOfficial = targets.some(item => item.flight?._etaSource !== 'fr24_api'
      || !isLiveEtaFresh(item, now) || now - item.flight._etaObservedAt >= FR24_REFRESH_MS);
    if (apiKey && needsOfficial && now >= cooldownUntil && now - lastApiAttempt >= FR24_REFRESH_MS) {
      lastApiAttempt = now;
      const flights = [...new Set(targets.map(item =>
        getCanonicalFlightNumberIdentity(item.flight?.identification?.number?.default)).filter(Boolean))];
      tasks.push(fetchFr24ArrivalUpdates(airport.code, airport, apiKey, flights, signal).then(updates => {
        publish(applyFlightLiveUpdates(current, updates, 'arrival'));
      }).catch(error => {
        if (/HTTP_(401|402|403|429)\b/.test(String(error))) cooldownUntil = Date.now() + 30 * 60 * 1000;
      }));
    }
    if (airport.latitude != null && airport.longitude != null
      && targets.some(item => item.flight?._etaSource !== 'fr24_api' || !isLiveEtaFresh(item))) {
      tasks.push(fetchAdsbAircraft(airport.latitude, airport.longitude, undefined, signal).then(aircraft => {
        publish(applyLiveArrivalEtas(current, aircraft, airport.latitude!, airport.longitude!));
      }).catch(() => {}));
    }
    await Promise.all(tasks);
  };
}
