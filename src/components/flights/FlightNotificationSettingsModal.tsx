import React from 'react';
import { Modal, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ThemeColors } from '../../context/ThemeContext';
import type { TranslationKey } from '../../i18n/translations';
import {
  clamp,
  MAX_NOTIF_MINUTES,
  MIN_NOTIF_MINUTES,
  type FlightNotificationSettings,
} from '../../utils/flightNotificationSettings';

type FlightNotificationSettingsModalProps = {
  visible: boolean;
  notifsEnabled: boolean;
  notifSummary: string;
  notifSettings: FlightNotificationSettings;
  colors: ThemeColors;
  styles: Record<string, any>;
  t: (key: TranslationKey) => string;
  onClose: () => void;
  onSetNotificationsEnabled: (next: boolean) => Promise<void>;
  onUpdateNotificationSettings: (patch: Partial<FlightNotificationSettings>) => Promise<void>;
};

export default function FlightNotificationSettingsModal({
  visible,
  notifsEnabled,
  notifSummary,
  notifSettings,
  colors,
  styles: s,
  t,
  onClose,
  onSetNotificationsEnabled,
  onUpdateNotificationSettings,
}: FlightNotificationSettingsModalProps) {
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
          <Text style={s.filterSheetTitle}>{t('flightNotifSettingsTitle')}</Text>
          <Text style={s.notifSheetSub}>{t('flightNotifSettingsSub')}</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.notifRow}>
              <View style={s.notifRowTextWrap}>
                <Text style={s.notifRowTitle}>{notifsEnabled ? t('flightNotifAccessDisable') : t('flightNotifAccessEnable')}</Text>
                <Text style={s.notifRowSub}>{notifSummary}</Text>
              </View>
              <Switch
                value={notifsEnabled}
                onValueChange={(value) => { onSetNotificationsEnabled(value).catch(() => {}); }}
                trackColor={{ false: '#94A3B8', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.notifDivider} />

            <View style={s.notifRow}>
              <View style={s.notifRowTextWrap}>
                <Text style={s.notifRowTitle}>{t('flightNotifOnlyTracked')}</Text>
                <Text style={s.notifRowSub}>{t('flightNotifOnlyTrackedSub')}</Text>
              </View>
              <Switch
                value={notifSettings.onlyTrackedAirlines}
                onValueChange={(value) => { onUpdateNotificationSettings({ onlyTrackedAirlines: value }).catch(() => {}); }}
                trackColor={{ false: '#94A3B8', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.notifRow}>
              <View style={s.notifRowTextWrap}>
                <Text style={s.notifRowTitle}>{t('flightNotifArrivalsToggle')}</Text>
                <Text style={s.notifRowSub}>{t('flightNotifArrivalsToggleSub')}</Text>
              </View>
              <Switch
                value={notifSettings.includeArrivals}
                onValueChange={(value) => { onUpdateNotificationSettings({ includeArrivals: value }).catch(() => {}); }}
                trackColor={{ false: '#94A3B8', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.notifRow}>
              <View style={s.notifRowTextWrap}>
                <Text style={s.notifRowTitle}>{t('flightNotifDeparturesToggle')}</Text>
                <Text style={s.notifRowSub}>{t('flightNotifDeparturesToggleSub')}</Text>
              </View>
              <Switch
                value={notifSettings.includeDepartures}
                onValueChange={(value) => { onUpdateNotificationSettings({ includeDepartures: value }).catch(() => {}); }}
                trackColor={{ false: '#94A3B8', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.notifRow}>
              <View style={s.notifRowTextWrap}>
                <Text style={s.notifRowTitle}>{t('flightNotifShiftEndToggle')}</Text>
                <Text style={s.notifRowSub}>{t('flightNotifShiftEndToggleSub')}</Text>
              </View>
              <Switch
                value={notifSettings.includeShiftEnd}
                onValueChange={(value) => { onUpdateNotificationSettings({ includeShiftEnd: value }).catch(() => {}); }}
                trackColor={{ false: '#94A3B8', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.notifRow}>
              <View style={s.notifRowTextWrap}>
                <Text style={s.notifRowTitle}>{t('flightNotifStickyToggle')}</Text>
                <Text style={s.notifRowSub}>{t('flightNotifStickyToggleSub')}</Text>
              </View>
              <Switch
                value={notifSettings.sticky}
                onValueChange={(value) => { onUpdateNotificationSettings({ sticky: value }).catch(() => {}); }}
                trackColor={{ false: '#94A3B8', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.notifDivider} />

            <View style={s.notifMinutesRow}>
              <Text style={s.notifRowTitle}>{t('flightNotifArrivalLead')}</Text>
              <View style={s.notifStepper}>
                <TouchableOpacity
                  style={s.notifStepperBtn}
                  onPress={() => onUpdateNotificationSettings({
                    arrivalLeadMinutes: clamp(notifSettings.arrivalLeadMinutes - 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                  }).catch(() => {})}
                >
                  <MaterialIcons name="remove" size={18} color={colors.primaryDark} />
                </TouchableOpacity>
                <Text style={s.notifStepperValue}>{notifSettings.arrivalLeadMinutes}m</Text>
                <TouchableOpacity
                  style={s.notifStepperBtn}
                  onPress={() => onUpdateNotificationSettings({
                    arrivalLeadMinutes: clamp(notifSettings.arrivalLeadMinutes + 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                  }).catch(() => {})}
                >
                  <MaterialIcons name="add" size={18} color={colors.primaryDark} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.notifMinutesRow}>
              <Text style={s.notifRowTitle}>{t('flightNotifDepartureLead')}</Text>
              <View style={s.notifStepper}>
                <TouchableOpacity
                  style={s.notifStepperBtn}
                  onPress={() => onUpdateNotificationSettings({
                    departureLeadMinutes: clamp(notifSettings.departureLeadMinutes - 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                  }).catch(() => {})}
                >
                  <MaterialIcons name="remove" size={18} color={colors.primaryDark} />
                </TouchableOpacity>
                <Text style={s.notifStepperValue}>{notifSettings.departureLeadMinutes}m</Text>
                <TouchableOpacity
                  style={s.notifStepperBtn}
                  onPress={() => onUpdateNotificationSettings({
                    departureLeadMinutes: clamp(notifSettings.departureLeadMinutes + 1, MIN_NOTIF_MINUTES, MAX_NOTIF_MINUTES),
                  }).catch(() => {})}
                >
                  <MaterialIcons name="add" size={18} color={colors.primaryDark} />
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
