import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getAirportInfo } from '../utils/airportSettings';
import { getFr24ApiKey, getFlightProviderPreference } from '../utils/flightProviderSettings';
import { applyFlightLiveUpdates } from '../utils/flightLiveUpdates';
import { createLiveArrivalRefresher, LIVE_ARRIVAL_REFRESH_MS } from '../utils/liveArrivalRefresh';

export function useLiveArrivals(arrivals: any[], airportCode: string, enabled: boolean): any[] {
  const [snapshot, setSnapshot] = useState<{ airport: string; items: any[] } | null>(null);
  const latest = useRef(arrivals);
  const refresh = useRef(createLiveArrivalRefresher());
  const merged = useMemo(() => snapshot?.airport === airportCode
    ? applyFlightLiveUpdates(arrivals, snapshot.items, 'arrival') : arrivals, [arrivals, snapshot, airportCode]);
  latest.current = merged;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let controller: AbortController | null = null;
    const load = async () => {
      if (!active || controller || (AppState.currentState && AppState.currentState !== 'active')) return;
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 8_000);
      try {
        const [apiKey, preference] = await Promise.all([getFr24ApiKey(), getFlightProviderPreference()]);
        if (!active || request.signal.aborted) return;
        await refresh.current({
          arrivals: latest.current, airport: getAirportInfo(airportCode),
          apiKey: preference === 'auto' || preference === 'fr24' ? apiKey : null,
          signal: request.signal,
          onProgress: items => {
            if (active && !request.signal.aborted) setSnapshot({ airport: airportCode, items });
          },
        });
      } finally {
        clearTimeout(timeout);
        if (controller === request) controller = null;
      }
    };
    const run = () => { load().catch(() => {}); };
    run();
    const interval = setInterval(run, LIVE_ARRIVAL_REFRESH_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') run(); else controller?.abort();
    });
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
      subscription.remove();
    };
  }, [airportCode, enabled]);
  return merged;
}
