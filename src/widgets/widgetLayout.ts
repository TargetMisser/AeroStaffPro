import type { WidgetData, WidgetFlight } from './widgetTaskHandler';

export function getWidgetLayout(width = 320, height = 320) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 320;
  return {
    compact: safeWidth < 300 || safeHeight < 320,
    minimal: safeHeight < 230,
    showDetails: safeWidth >= 300 && safeHeight >= 340,
    horizontalPadding: safeWidth < 300 ? 10 : 14,
  };
}

export function getWidgetShiftHeading(label: string) {
  const tomorrow = /^domani\s+/i.test(label);
  return { day: tomorrow ? 'DOMANI' : 'OGGI', time: label.replace(/^domani\s+/i, '').trim() };
}

export function getWidgetFlightDetails(flight: WidgetFlight): string {
  return ([['Stand', flight.stand], ['Banco', flight.checkin], ['Uscita', flight.gate]] as const)
    .filter(([, value]) => value && !['-', '--', 'N/A', 'N/D'].includes(value.trim().toUpperCase()))
    .map(([label, value]) => `${label} ${value!.trim()}`)
    .join(' · ');
}

export function getWidgetStatusLabel(data: WidgetData): string | null {
  if (data.state !== 'work' && data.state !== 'work_empty') return null;
  if (data.presentation?.showDataAge === false) return null;
  const time = data.updatedAt ? ` · ${data.updatedAt}` : '';
  if (data.presentation?.freshness === 'offline') return `Offline${time}`;
  if (!data.updatedAt || data.presentation?.freshness === 'stale') return `Dati da aggiornare${time}`;
  return `Aggiornato${time}`;
}
