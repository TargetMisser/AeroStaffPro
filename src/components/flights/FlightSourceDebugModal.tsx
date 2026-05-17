import React from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ThemeColors } from '../../context/ThemeContext';
import type { TranslationKey } from '../../i18n/translations';
import type { FlightScheduleProviderStatus } from '../../utils/fr24api';
import { formatFlightSourceLabel } from '../../utils/flightSourceLabel';
import {
  formatFlightCacheAge,
  formatProviderDiagnostic,
  getTomorrowEmptyReason,
  getTomorrowEmptyReasonTranslationKey,
  type FlightListTab,
} from '../../utils/flightDiagnostics';

type FlightSourceDebugModalProps = {
  visible: boolean;
  activeDay: 'today' | 'tomorrow';
  activeTab: FlightListTab;
  sourceLabel?: string;
  fetchedAt?: number;
  diagnostics?: FlightScheduleProviderStatus[];
  visibleCount: number;
  rawDayCount: number;
  selectedAirlinesCount: number;
  airportAirlinesCount: number;
  isRefreshing: boolean;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  locale: string;
  onClose: () => void;
};

function providerTone(item: FlightScheduleProviderStatus): string {
  if (item.status === 'failed') return '#EF4444';
  if (item.status === 'skipped') return '#94A3B8';
  if (item.cacheMerged) return '#F59E0B';
  return item.contributed === false ? '#64748B' : '#10B981';
}

export default function FlightSourceDebugModal({
  visible,
  activeDay,
  activeTab,
  sourceLabel,
  fetchedAt,
  diagnostics = [],
  visibleCount,
  rawDayCount,
  selectedAirlinesCount,
  airportAirlinesCount,
  isRefreshing,
  colors,
  t,
  locale,
  onClose,
}: FlightSourceDebugModalProps) {
  const reason = activeDay === 'tomorrow'
    ? getTomorrowEmptyReason({ rawDayCount, activeTab, diagnostics })
    : null;
  const updatedAt = fetchedAt
    ? new Date(fetchedAt).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'n/d';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={[styles.headerIcon, { backgroundColor: colors.primaryLight }]}>
              <MaterialIcons name="hub" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>{t('flightSourceDebugTitle')}</Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('flightSourceDebugSub')}</Text>
            </View>
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.cardSecondary }]} onPress={onClose}>
              <MaterialIcons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={[styles.sourcePill, { backgroundColor: colors.primaryLight, borderColor: colors.glassBorder }]}>
              <MaterialIcons name="flight" size={15} color={colors.primary} />
              <Text style={[styles.sourceText, { color: colors.primaryDark }]}>
                {formatFlightSourceLabel(sourceLabel ?? 'n/d')}
              </Text>
            </View>

            {isRefreshing ? (
              <View style={[styles.refreshRow, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.metaValue, { color: colors.text }]}>{t('flightSourceDebugRefresh')}</Text>
              </View>
            ) : null}

            <View style={styles.metaGrid}>
              <View style={[styles.metaBox, { backgroundColor: colors.cardSecondary }]}>
                <Text style={[styles.metaLabel, { color: colors.textMuted }]}>{t('flightSourceDebugUpdated')}</Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>{updatedAt}</Text>
              </View>
              <View style={[styles.metaBox, { backgroundColor: colors.cardSecondary }]}>
                <Text style={[styles.metaLabel, { color: colors.textMuted }]}>{t('flightSourceDebugAge')}</Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>{formatFlightCacheAge(fetchedAt)}</Text>
              </View>
              <View style={[styles.metaBox, { backgroundColor: colors.cardSecondary }]}>
                <Text style={[styles.metaLabel, { color: colors.textMuted }]}>{t('flightSourceDebugVisible')}</Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>{visibleCount}</Text>
              </View>
              <View style={[styles.metaBox, { backgroundColor: colors.cardSecondary }]}>
                <Text style={[styles.metaLabel, { color: colors.textMuted }]}>{t('flightSourceDebugRaw')}</Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>{rawDayCount}</Text>
              </View>
            </View>

            <View style={[styles.filterBox, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
              <Text style={[styles.metaLabel, { color: colors.textMuted }]}>{t('flightSourceDebugFilters')}</Text>
              <Text style={[styles.filterText, { color: colors.text }]}>
                {selectedAirlinesCount}/{airportAirlinesCount || selectedAirlinesCount} compagnie monitorate
              </Text>
              {reason ? (
                <Text style={[styles.reasonText, { color: colors.textMuted }]}>
                  {t(getTomorrowEmptyReasonTranslationKey(reason))}
                </Text>
              ) : null}
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {t('flightSourceDebugProviders')}
            </Text>
            <View style={styles.providerList}>
              {diagnostics.length > 0 ? diagnostics.map((item, index) => (
                <View
                  key={`${item.provider}_${index}`}
                  style={[styles.providerRow, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
                >
                  <View style={[styles.statusDot, { backgroundColor: providerTone(item) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.providerName, { color: colors.text }]}>{item.label}</Text>
                    <Text style={[styles.providerSub, { color: colors.textMuted }]}>
                      {formatProviderDiagnostic(item)}
                    </Text>
                  </View>
                </View>
              )) : (
                <Text style={[styles.providerSub, { color: colors.textMuted }]}>
                  {t('flightSourceDebugNoProviders')}
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.62)',
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    maxHeight: '84%',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '900' },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sourceText: { flexShrink: 1, fontSize: 12, fontWeight: '900' },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaBox: { minWidth: '47%', flexGrow: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  metaLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  metaValue: { fontSize: 14, fontWeight: '900', marginTop: 3 },
  filterBox: { borderWidth: 1, borderRadius: 16, padding: 12 },
  filterText: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  reasonText: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  sectionTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginTop: 4 },
  providerList: { gap: 8 },
  providerRow: { flexDirection: 'row', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  providerName: { fontSize: 13, fontWeight: '900' },
  providerSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
});
