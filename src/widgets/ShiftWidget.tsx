import React from 'react';
import { WEIGHT } from '../theme/typography';
import { FlexWidget, TextWidget, ListWidget } from 'react-native-android-widget';
import type { ThemeMode, ThemeSnapshotColors } from '../utils/themeMode';
import type { WidgetData, WidgetFlight } from './widgetTaskHandler';
import { getWidgetThemePalette, type WidgetThemePalette } from './widgetTheme';
import { getWidgetFlightDetails, getWidgetLayout, getWidgetShiftHeading, getWidgetStatusLabel } from './widgetLayout';

type ShiftWidgetProps = {
  data: WidgetData;
  themeMode?: ThemeMode;
  themeSnapshot?: ThemeSnapshotColors | null;
  width?: number;
  height?: number;
};
type Layout = ReturnType<typeof getWidgetLayout>;

function FlightRow({ flight, theme, layout }: { flight: WidgetFlight; theme: WidgetThemePalette; layout: Layout }) {
  const details = layout.showDetails ? getWidgetFlightDetails(flight) : '';
  const accessibilityLabel = `${flight.isPinned ? 'Volo seguito, ' : ''}${flight.flightNumber}, ${flight.destinationIata}, partenza ${flight.departureTime}. Check-in ${flight.ciOpen}–${flight.ciClose}. Gate ${flight.gateOpen}–${flight.gateClose}.${details ? ' ' + details : ''}`;
  return (
    <FlexWidget
      style={{ width: 'match_parent', padding: layout.compact ? 10 : 12, marginBottom: 8, backgroundColor: flight.isPinned ? theme.pinnedBg : theme.cardOdd, borderRadius: 16, borderWidth: 1, borderColor: flight.isPinned ? theme.accent : theme.border }}
      clickAction="OPEN_APP"
      accessibilityLabel={accessibilityLabel}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: 3, height: 24, borderRadius: 2, backgroundColor: flight.airlineColor, marginRight: 8 }} />
        <FlexWidget style={{ flex: 1, width: 0 }}>
          <TextWidget text={flight.flightNumber + (flight.isPinned ? ' · SEGUITO' : '')} maxLines={1} truncate="END" style={{ color: flight.isPinned ? theme.accentText : theme.muted, fontSize: 10, fontWeight: WEIGHT.medium }} />
          <TextWidget text={flight.destinationIata} maxLines={1} truncate="END" style={{ color: theme.text, fontSize: layout.compact ? 15 : 18, fontWeight: WEIGHT.semibold }} />
        </FlexWidget>
        <TextWidget text={flight.departureTime} maxLines={1} style={{ fontSize: layout.compact ? 21 : 24, fontWeight: WEIGHT.semibold, color: theme.text, marginLeft: 8 }} />
      </FlexWidget>
      {!layout.minimal && (
        <FlexWidget style={{ width: 'match_parent', marginTop: 8 }}>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
            <TextWidget text="Check-in" style={{ fontSize: 11, color: theme.accentText }} />
            <FlexWidget style={{ flex: 1 }} />
            <TextWidget text={`${flight.ciOpen} – ${flight.ciClose}`} style={{ fontSize: 12, fontWeight: WEIGHT.medium, color: theme.text }} />
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <TextWidget text="Gate" style={{ fontSize: 11, color: theme.gate }} />
            <FlexWidget style={{ flex: 1 }} />
            <TextWidget text={`${flight.gateOpen} – ${flight.gateClose}`} style={{ fontSize: 12, fontWeight: WEIGHT.medium, color: theme.text }} />
          </FlexWidget>
        </FlexWidget>
      )}
      {!!details && <TextWidget text={details} maxLines={2} truncate="END" style={{ fontSize: 10, color: theme.muted, marginTop: 7 }} />}
    </FlexWidget>
  );
}

function EmptyState({ data, theme, compact }: { data: WidgetData; theme: WidgetThemePalette; compact: boolean }) {
  const isRest = data.state === 'rest';
  const isError = data.state === 'error';
  const title = isRest ? 'Giorno di riposo' : isError ? 'Dati non disponibili' : data.state === 'work_empty' ? 'Nessuna partenza' : 'Nessun turno oggi';
  const hint = isRest ? 'La giornata è tua.' : isError ? 'Tocca Aggiorna per riprovare.' : data.state === 'work_empty' ? 'Nessun volo da mostrare per il turno.' : 'Apri AeroStaff per vedere il calendario.';
  return (
    <FlexWidget style={{ flex: 1, height: 0, width: 'match_parent', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }} clickAction="OPEN_APP" accessibilityLabel={`${title}. ${hint}`}>
      <FlexWidget style={{ width: 40, height: 4, borderRadius: 2, marginBottom: 14, backgroundColor: isRest ? theme.restAccent : isError ? theme.errorAccent : theme.accent }} />
      <TextWidget text={title} maxLines={2} style={{ fontSize: compact ? 18 : 22, fontWeight: WEIGHT.semibold, color: theme.text, textAlign: 'center' }} />
      <TextWidget text={hint} maxLines={3} style={{ fontSize: 12, color: theme.muted, textAlign: 'center', marginTop: 6 }} />
    </FlexWidget>
  );
}

export function ShiftWidget({ data, themeMode = 'light', themeSnapshot, width = 320, height = 320 }: ShiftWidgetProps) {
  const theme = getWidgetThemePalette(themeMode, themeSnapshot);
  const layout = getWidgetLayout(width, height);
  const hasShift = data.state === 'work' || data.state === 'work_empty';
  const heading = hasShift ? getWidgetShiftHeading(data.shiftLabel) : null;
  const status = getWidgetStatusLabel(data);
  const context = hasShift && data.presentation?.mode === 'load'
    ? `${data.presentation.workloadCount} voli / ${data.presentation.workloadWindowMinutes} min`
    : hasShift && data.presentation?.mode === 'pinned'
      ? (data.state === 'work' && data.flights.some(flight => flight.isPinned) ? 'Volo seguito' : 'Prossimo volo')
      : '';
  return (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: theme.bg, borderRadius: 24, borderWidth: 1, borderColor: theme.border, paddingTop: 6, paddingBottom: 6, overflow: 'hidden' }} accessibilityLabel="AeroStaff Pro, turno e voli">
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: layout.horizontalPadding, paddingRight: 6 }}>
        <FlexWidget style={{ flex: 1, width: 0 }} clickAction="OPEN_APP" accessibilityLabel="Apri AeroStaff Pro">
          <TextWidget text="AEROSTAFF PRO" maxLines={1} style={{ fontSize: 10, fontWeight: WEIGHT.semibold, letterSpacing: 1, color: theme.accentText }} />
        </FlexWidget>
        <FlexWidget style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} clickAction="REFRESH" accessibilityLabel="Aggiorna widget">
          <FlexWidget style={{ width: 32, height: 32, borderRadius: 12, backgroundColor: theme.accentBg, justifyContent: 'center', alignItems: 'center' }}>
            <TextWidget text="↻" allowFontScaling={false} style={{ fontSize: 24, color: theme.accentText }} />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
      {heading && (
        <FlexWidget style={{ width: 'match_parent', paddingHorizontal: layout.horizontalPadding, paddingBottom: layout.minimal ? 6 : 10 }} clickAction="OPEN_APP" accessibilityLabel={`${heading.day} ${heading.time}${context ? ', ' + context : ''}`}>
          {!layout.minimal && <TextWidget text={heading.day + (context ? ' · ' + context : '')} maxLines={1} truncate="END" style={{ fontSize: 10, color: theme.muted, fontWeight: WEIGHT.medium, marginBottom: 3 }} />}
          <TextWidget text={(layout.minimal && heading.day === 'DOMANI' ? 'Domani ' : '') + heading.time} maxLines={1} style={{ fontSize: layout.compact ? 22 : 26, adjustsFontSizeToFit: true, fontWeight: WEIGHT.semibold, color: theme.text }} />
        </FlexWidget>
      )}
      {data.state === 'work' && data.flights.length > 0 ? (
        <FlexWidget style={{ flex: 1, height: 0, width: 'match_parent', paddingHorizontal: layout.horizontalPadding }}>
          <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
            {data.flights.map((flight, index) => <FlightRow key={`${flight.flightNumber}-${index}`} flight={flight} theme={theme} layout={layout} />)}
          </ListWidget>
        </FlexWidget>
      ) : <EmptyState data={data.state === 'work' ? { ...data, state: 'work_empty' } : data} theme={theme} compact={layout.compact} />}
      {!!status && <TextWidget text={status} maxLines={1} truncate="END" style={{ fontSize: 10, color: hasShift && data.presentation?.freshness === 'offline' ? theme.errorAccent : theme.muted, paddingHorizontal: layout.horizontalPadding, paddingTop: 7, paddingBottom: 3 }} />}
    </FlexWidget>
  );
}
