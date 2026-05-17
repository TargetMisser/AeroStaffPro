import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AirlineFilterLogo } from './AirlineLogo';
import type { ThemeColors } from '../../context/ThemeContext';
import type { TranslationKey } from '../../i18n/translations';
import { AIRLINE_DISPLAY_NAMES } from '../../utils/airlineOps';
import {
  getAirlineBrandColor,
  getAirlineIataCode,
  hexToRgba,
  prettifyAirlineLabel,
} from '../../utils/airlineBranding';

type FlightFilterModalProps = {
  visible: boolean;
  allSelected: boolean;
  airportAirlines: string[];
  selectedAirlines: string[];
  colors: ThemeColors;
  styles: Record<string, any>;
  t: (key: TranslationKey) => string;
  onClose: () => void;
  onApplySelectedAirlines: (airlines: string[]) => void;
};

export default function FlightFilterModal({
  visible,
  allSelected,
  airportAirlines,
  selectedAirlines,
  colors,
  styles: s,
  t,
  onClose,
  onApplySelectedAirlines,
}: FlightFilterModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={s.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={s.filterSheet} onStartShouldSetResponder={() => true}>
          <View style={s.filterSheetHandle} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={s.filterSheetTitle}>{t('flightFilterTitle')}</Text>
            <TouchableOpacity
              onPress={() => {
                const next = allSelected ? [] : [...airportAirlines];
                onApplySelectedAirlines(next);
              }}
            >
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                {allSelected ? t('flightFilterDeselAll') : t('flightFilterSelAll')}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {airportAirlines.map(key => {
              const checked = selectedAirlines.includes(key);
              const label = AIRLINE_DISPLAY_NAMES[key] ?? prettifyAirlineLabel(key);
              const brandColor = getAirlineBrandColor(key, label);
              const iataCode = getAirlineIataCode(key, label);
              const activeBg = hexToRgba(brandColor, colors.isDark ? 0.24 : 0.18);
              const inactiveBg = colors.isDark ? 'rgba(2,6,18,0.92)' : 'rgba(255,255,255,0.92)';
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    s.filterOption,
                    {
                      backgroundColor: checked ? activeBg : inactiveBg,
                      borderColor: checked ? hexToRgba(brandColor, 0.72) : hexToRgba(brandColor, 0.28),
                    },
                    checked && s.filterOptionActive,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => {
                    const next = checked
                      ? selectedAirlines.filter(k => k !== key)
                      : [...selectedAirlines, key];
                    onApplySelectedAirlines(next);
                  }}
                >
                  <AirlineFilterLogo iataCode={iataCode} label={label} color={brandColor} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.filterOptionText, checked && { color: brandColor }]}>{label}</Text>
                    <Text style={s.filterOptionSub}>
                      {iataCode ? `IATA ${iataCode}` : key}
                    </Text>
                  </View>
                  <View style={[s.filterBrandDotWrap, { backgroundColor: hexToRgba(brandColor, 0.16), borderColor: hexToRgba(brandColor, 0.45) }]}>
                    <View style={[s.filterBrandDot, { backgroundColor: brandColor }]} />
                  </View>
                  <MaterialIcons
                    name={checked ? 'check-box' : 'check-box-outline-blank'}
                    size={22}
                    color={checked ? brandColor : '#9CA3AF'}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
