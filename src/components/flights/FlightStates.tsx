import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { ThemeColors } from '../../context/ThemeContext';
import type { TranslationKey } from '../../i18n/translations';
import type { FlightScheduleProviderStatus } from '../../utils/fr24api';

type FlightListTab = 'arrivals' | 'departures';
type FlightListDay = 'today' | 'tomorrow';

function formatProviderDiagnostic(item: FlightScheduleProviderStatus): string {
  if (item.status === 'success') {
    const hasDayCounts = typeof item.todayArrivals === 'number'
      || typeof item.todayDepartures === 'number'
      || typeof item.tomorrowArrivals === 'number'
      || typeof item.tomorrowDepartures === 'number';
    if (!hasDayCounts) {
      return `${item.label}: A ${item.arrivals ?? 0} / P ${item.departures ?? 0}`;
    }
    return `${item.label}: oggi A${item.todayArrivals ?? 0}/P${item.todayDepartures ?? 0}, domani A${item.tomorrowArrivals ?? 0}/P${item.tomorrowDepartures ?? 0}`;
  }

  const status = item.status === 'skipped' ? 'saltato' : 'errore';
  const message = item.message ? ` - ${item.message.slice(0, 96)}` : '';
  return `${item.label}: ${status}${message}`;
}

export function EmptyFlightState({
  activeDay,
  activeTab,
  rawDayCount,
  sourceLabel,
  diagnostics,
  colors,
  t,
}: {
  activeDay: FlightListDay;
  activeTab: FlightListTab;
  rawDayCount: number;
  sourceLabel?: string;
  diagnostics?: FlightScheduleProviderStatus[];
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}) {
  const hiddenByFilters = rawDayCount > 0;
  const title = hiddenByFilters
    ? t('flightNoFlightsFilteredTitle')
    : activeDay === 'tomorrow'
      ? t('flightTomorrowEmptyTitle')
      : t('flightNoFlights');
  const body = hiddenByFilters
    ? t('flightNoFlightsFilteredMsg').replace('{count}', String(rawDayCount))
    : activeDay === 'tomorrow'
      ? t('flightTomorrowEmptyMsg')
      : '';
  const providerLines = activeDay === 'tomorrow'
    ? (diagnostics ?? []).slice(0, 5).map(formatProviderDiagnostic)
    : [];
  const tabLabel = activeTab === 'arrivals' ? t('flightArrivals') : t('flightDepartures');

  return (
    <View style={{
      marginTop: 32,
      padding: 16,
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }}>{title}</Text>
      {body ? (
        <Text style={{ color: colors.textSub, fontSize: 13, lineHeight: 19, marginTop: 8 }}>{body}</Text>
      ) : null}
      {activeDay === 'tomorrow' ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10 }}>
          {t('flightTomorrowEmptyContext')
            .replace('{tab}', tabLabel)
            .replace('{source}', sourceLabel ?? 'n/d')}
        </Text>
      ) : null}
      {providerLines.length > 0 ? (
        <View style={{ marginTop: 12, gap: 6 }}>
          <Text style={{ color: colors.textSub, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>
            {t('flightProviderDebugTitle')}
          </Text>
          {providerLines.map((line, index) => (
            <Text key={`${line}_${index}`} style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function FlightLoadingState({
  colors,
  t,
}: {
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 28 }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderRadius: 20,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
      }}>
        <View style={{
          width: 52,
          height: 52,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primaryLight,
        }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }}>
            {t('flightLoadingTitle')}
          </Text>
          <Text style={{ color: colors.textSub, fontSize: 13, lineHeight: 19, marginTop: 5 }}>
            {t('flightLoadingMsg')}
          </Text>
        </View>
      </View>
    </View>
  );
}
