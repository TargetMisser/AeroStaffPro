import { NativeModules, Platform } from 'react-native';
import { getAirlineOps, getAirlineColor } from '../utils/airlineOps';
import { getFlightAirportLabel } from '../utils/flightScheduleAdapter';

const { WearDataSender } = NativeModules;

/**
 * Transforms a FR24 flight item (as stored in AsyncStorage) into the JSON
 * format expected by the WearOS FlightData.fromJson().
 */
function flightItemToWearJson(item: any): string {
  const tab: string = item._pinTab || 'departures';
  const airline = item.flight?.airline?.name || 'Sconosciuta';
  const iataCode = item.flight?.airline?.code?.iata || '';
  const airlineIdentity = [
    airline,
    iataCode,
    item.flight?.airline?.code?.icao,
  ].filter(Boolean).join(' ');
  const ops = tab === 'departures' ? getAirlineOps(airlineIdentity) : null;

  const payload: Record<string, any> = {
    flightNumber: item.flight?.identification?.number?.default || 'N/A',
    airline,
    airlineColor: getAirlineColor(airlineIdentity),
    iataCode,
    tab,
    destination: getFlightAirportLabel(item.flight?.airport?.destination, ''),
    origin: getFlightAirportLabel(item.flight?.airport?.origin, ''),
    scheduledTime:
      tab === 'arrivals'
        ? item.flight?.time?.scheduled?.arrival ?? 0
        : item.flight?.time?.scheduled?.departure ?? 0,
    pinnedAt: Math.floor((item._pinnedAt || Date.now()) / 1000),
  };

  // Optional times
  const est =
    tab === 'arrivals'
      ? item.flight?.time?.estimated?.arrival
      : item.flight?.time?.estimated?.departure;
  if (est) payload.estimatedTime = est;

  if (item.flight?.time?.real?.departure)
    payload.realDeparture = item.flight.time.real.departure;
  if (item.flight?.time?.real?.arrival)
    payload.realArrival = item.flight.time.real.arrival;

  // For departures: if inbound aircraft arrival is known, send it for dynamic gate open
  if (tab === 'departures' && item._inboundArrival)
    payload.inboundArrival = item._inboundArrival;

  if (ops) {
    payload.ops = {
      checkInOpen: ops.checkInOpen,
      checkInClose: ops.checkInClose,
      gateOpen: ops.gateOpen,
      gateClose: ops.gateClose,
    };
  }

  return JSON.stringify(payload);
}

export async function sendPinnedFlightToWatch(item: any): Promise<void> {
  if (Platform.OS !== 'android' || !WearDataSender) return;
  const json = flightItemToWearJson(item);
  await WearDataSender.sendPinnedFlight(json);
}

export async function clearPinnedFlightOnWatch(): Promise<void> {
  if (Platform.OS !== 'android' || !WearDataSender) return;
  await WearDataSender.clearPinnedFlight();
}

export async function startWatchOngoing(item: any, shiftEnd: number): Promise<void> {
  if (Platform.OS !== 'android' || !WearDataSender) return;
  const json = flightItemToWearJson(item);
  await WearDataSender.startWatchOngoing(json, shiftEnd);
}

export async function sendWatchAlert(title: string, body: string, type: string): Promise<void> {
  if (Platform.OS !== 'android' || !WearDataSender) return;
  await WearDataSender.sendWatchAlert(title, body, type);
}

export async function stopWatchOngoing(): Promise<void> {
  if (Platform.OS !== 'android' || !WearDataSender) return;
  await WearDataSender.stopWatchOngoing();
}
