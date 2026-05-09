import React from 'react';
import { FlexWidget, TextWidget, ListWidget } from 'react-native-android-widget';
import type { ThemeMode, ThemeSnapshotColors } from '../utils/themeMode';
import type { WidgetData, WidgetFlight } from './widgetTaskHandler';
import { getWidgetThemePalette, type WidgetThemePalette } from './widgetTheme';

const PILL_R = 10;

type ShiftWidgetProps = {
  data: WidgetData;
  themeMode?: ThemeMode;
  themeSnapshot?: ThemeSnapshotColors | null;
};

function FlightRow({
  flight,
  index,
  theme,
}: {
  flight: WidgetFlight;
  index: number;
  theme: WidgetThemePalette;
}) {
  const pinned = flight.isPinned === true;
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: pinned ? theme.pinnedBg : (index % 2 === 0 ? theme.cardOdd : theme.cardEven),
        flexDirection: 'column',
        ...(pinned ? { borderLeftWidth: 3, borderLeftColor: theme.accent } : {}),
      }}
      clickAction="OPEN_APP"
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <FlexWidget
            style={{
              backgroundColor: flight.airlineColor,
              borderRadius: PILL_R,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <TextWidget
              text={flight.flightNumber}
              style={{ fontSize: 12, fontWeight: 'bold', color: theme.airlineText }}
            />
          </FlexWidget>
          <FlexWidget
            style={{
              backgroundColor: theme.chipBg,
              borderRadius: PILL_R,
              paddingHorizontal: 7,
              paddingVertical: 3,
              marginLeft: 6,
            }}
          >
            <TextWidget
              text={flight.destinationIata}
              style={{ fontSize: 12, fontWeight: 'bold', color: theme.text }}
            />
          </FlexWidget>
        </FlexWidget>
        <TextWidget
          text={flight.departureTime}
          style={{ fontSize: 15, fontWeight: 'bold', color: pinned ? theme.accent : theme.text }}
        />
      </FlexWidget>

      <FlexWidget
        style={{ width: 'match_parent', flexDirection: 'row', marginTop: 5 }}
      >
        <FlexWidget
          style={{
            backgroundColor: theme.accentBg,
            borderRadius: PILL_R,
            paddingHorizontal: 8,
            paddingVertical: 3,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <TextWidget text="CI" style={{ fontSize: 12, fontWeight: 'bold', color: theme.accentText }} />
          <TextWidget text={` ${flight.ciOpen}-${flight.ciClose}`} style={{ fontSize: 12, color: theme.accentText }} />
        </FlexWidget>
        <FlexWidget
          style={{
            backgroundColor: theme.gateBg,
            borderRadius: PILL_R,
            paddingHorizontal: 8,
            paddingVertical: 3,
            marginLeft: 6,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <TextWidget text="Gate" style={{ fontSize: 12, fontWeight: 'bold', color: theme.gate }} />
          <TextWidget text={` ${flight.gateOpen}-${flight.gateClose}`} style={{ fontSize: 12, color: theme.gate }} />
        </FlexWidget>
      </FlexWidget>

      <FlexWidget
        style={{ width: 'match_parent', flexDirection: 'row', marginTop: 4 }}
      >
        <FlexWidget
          style={{
            backgroundColor: theme.detailBg,
            borderRadius: PILL_R,
            paddingHorizontal: 7,
            paddingVertical: 2,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <TextWidget text="Stand " style={{ fontSize: 10, fontWeight: 'bold', color: theme.muted }} />
          <TextWidget text={flight.stand ?? '-'} style={{ fontSize: 10, color: theme.text }} />
        </FlexWidget>
        <FlexWidget
          style={{
            backgroundColor: theme.detailBg,
            borderRadius: PILL_R,
            paddingHorizontal: 7,
            paddingVertical: 2,
            marginLeft: 5,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <TextWidget text="Banco " style={{ fontSize: 10, fontWeight: 'bold', color: theme.muted }} />
          <TextWidget text={flight.checkin ?? '-'} style={{ fontSize: 10, color: theme.text }} />
        </FlexWidget>
        <FlexWidget
          style={{
            backgroundColor: theme.detailBg,
            borderRadius: PILL_R,
            paddingHorizontal: 7,
            paddingVertical: 2,
            marginLeft: 5,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <TextWidget text="Uscita " style={{ fontSize: 10, fontWeight: 'bold', color: theme.muted }} />
          <TextWidget text={flight.gate ?? '-'} style={{ fontSize: 10, color: theme.text }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

function Header({ label, theme }: { label?: string; theme: WidgetThemePalette }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'column',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
      }}
      clickAction="OPEN_APP"
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          height: 3,
          backgroundColor: theme.accent,
        }}
      />
      <FlexWidget
        style={{
          width: 'match_parent',
          backgroundColor: theme.headerBg,
          paddingVertical: 10,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <FlexWidget
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent, marginRight: 8 }}
        />
        <TextWidget
          text={label ? `Turno  ${label}` : 'AeroStaff Pro'}
          style={{ fontSize: 14, fontWeight: 'bold', color: theme.text }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

function Footer({ updatedAt, theme }: { updatedAt: string; theme: WidgetThemePalette }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        backgroundColor: theme.headerBg,
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
      }}
      clickAction="OPEN_APP"
    >
      <FlexWidget
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent, marginRight: 6 }}
      />
      <TextWidget
        text={`Aggiornato: ${updatedAt}`}
        style={{ fontSize: 10, color: theme.muted }}
      />
    </FlexWidget>
  );
}

export function ShiftWidget({ data, themeMode = 'light', themeSnapshot }: ShiftWidgetProps) {
  const theme = getWidgetThemePalette(themeMode, themeSnapshot);
  const rootStyle = {
    height: 'match_parent' as const,
    width: 'match_parent' as const,
    backgroundColor: theme.bg,
    borderRadius: 20,
    flexDirection: 'column' as const,
    overflow: 'hidden' as const,
  };

  if (data.state === 'rest') {
    return (
      <FlexWidget style={rootStyle} clickAction="OPEN_APP">
        <FlexWidget style={{ width: 'match_parent', height: 3, backgroundColor: theme.restAccent }} />
        <FlexWidget
          style={{ flex: 1, width: 'match_parent', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}
        >
          <FlexWidget
            style={{
              backgroundColor: theme.restBg,
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <FlexWidget
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.restAccent, marginRight: 6 }}
            />
            <TextWidget
              text="RIPOSO"
              style={{ fontSize: 13, fontWeight: 'bold', color: theme.restAccent }}
            />
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', alignItems: 'center', marginTop: 8 }}>
            <TextWidget
              text="Giorno di Riposo"
              style={{ fontSize: 18, fontWeight: 'bold', color: theme.text, textAlign: 'center' }}
            />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
    );
  }

  if (data.state === 'no_shift') {
    return (
      <FlexWidget style={rootStyle} clickAction="OPEN_APP">
        <FlexWidget style={{ width: 'match_parent', height: 3, backgroundColor: theme.accent }} />
        <FlexWidget
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <TextWidget
            text="Nessun turno oggi"
            style={{ fontSize: 16, color: theme.muted }}
          />
        </FlexWidget>
      </FlexWidget>
    );
  }

  if (data.state === 'error') {
    return (
      <FlexWidget style={rootStyle} clickAction="REFRESH">
        <FlexWidget style={{ width: 'match_parent', height: 3, backgroundColor: theme.errorAccent }} />
        <FlexWidget
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}
        >
          <TextWidget
            text="Aggiornamento fallito"
            style={{ fontSize: 14, color: theme.errorAccent }}
          />
          <TextWidget
            text="Tocca per riprovare"
            style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}
          />
        </FlexWidget>
      </FlexWidget>
    );
  }

  if (data.state === 'work_empty') {
    return (
      <FlexWidget style={rootStyle} clickAction="OPEN_APP">
        <Header label={data.shiftLabel} theme={theme} />
        <FlexWidget
          style={{ flex: 1, width: 'match_parent', justifyContent: 'center', alignItems: 'center' }}
        >
          <TextWidget text="Nessuna partenza" style={{ fontSize: 14, color: theme.muted }} />
        </FlexWidget>
        <Footer updatedAt={data.updatedAt} theme={theme} />
      </FlexWidget>
    );
  }

  return (
    <FlexWidget style={rootStyle}>
      <Header label={data.shiftLabel} theme={theme} />
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {data.flights.map((flight, i) => (
          <FlightRow key={`${flight.flightNumber}-${i}`} flight={flight} index={i} theme={theme} />
        ))}
      </ListWidget>
      <Footer updatedAt={data.updatedAt} theme={theme} />
    </FlexWidget>
  );
}
