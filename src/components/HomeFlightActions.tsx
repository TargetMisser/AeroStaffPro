import React, { useMemo } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAppTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { buildFlightradar24AirportBoardUrl } from '../utils/flightExternalLinks';
import { RADIUS, SPACING } from '../theme/spacing';

export default function HomeFlightActions({ airportCode, onOpenFlights }: {
  airportCode: string;
  onOpenFlights: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.lg },
    action: { flexGrow: 1, flexBasis: 144, minHeight: 100, padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.card, gap: 10 },
    iconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
    detail: { color: colors.textSub, fontSize: 12, lineHeight: 17 },
    copy: { gap: 3 },
  }), [colors]);
  const url = buildFlightradar24AirportBoardUrl(airportCode, 'arrival');
  const openArrivals = async () => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('error'), t('flightDebugOpenLinkError'));
    }
  };
  return (
    <View style={s.row}>
      <TouchableOpacity style={s.action} onPress={onOpenFlights} activeOpacity={0.8}
        accessibilityRole="button" accessibilityLabel={t('homeOpenFlights')}>
        <View style={s.iconRow}>
          <MaterialIcons name="view-list" size={23} color={colors.primaryText} />
          <MaterialIcons name="arrow-forward" size={18} color={colors.textSub} />
        </View>
        <View style={s.copy}>
          <Text style={s.title}>{t('homeOpenFlights')}</Text>
          <Text style={s.detail}>{t('homeFlightOperations')}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={s.action} onPress={openArrivals} activeOpacity={0.8}
        disabled={!url} accessibilityRole="link" accessibilityState={{ disabled: !url }}
        accessibilityLabel={t('flightOpenAirportArrivalsFr24').replace('{airport}', airportCode)}>
        <View style={s.iconRow}>
          <MaterialIcons name="flight-land" size={23} color={colors.primaryText} />
          <MaterialIcons name="open-in-new" size={18} color={colors.textSub} />
        </View>
        <View style={s.copy}>
          <Text style={s.title}>{t('flightAirportArrivalsFr24')}</Text>
          <Text style={s.detail}>{airportCode} · Flightradar24</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}
