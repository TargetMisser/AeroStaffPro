import { translations, type TranslationKey } from '../i18n/translations';

export type HomeOperationalTone = 'active' | 'next' | 'ended' | 'rest' | 'empty' | 'loading';

export type HomeOperationalSummaryInput = {
  loadingShift: boolean;
  shiftKind: 'today' | 'next' | 'rest' | 'none';
  isWork: boolean;
  isRest: boolean;
  shiftStartMs?: number | null;
  shiftEndMs?: number | null;
  nowMs: number;
  locale?: string;
};

export type HomeOperationalSummary = {
  kicker: string;
  title: string;
  detail: string;
  tone: HomeOperationalTone;
};

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
}

export function buildHomeOperationalSummary(input: HomeOperationalSummaryInput): HomeOperationalSummary {
  const locale = input.locale ?? 'it-IT';
  const t = (key: TranslationKey) => translations[locale.startsWith('en') ? 'en' : 'it'][key];
  if (input.loadingShift) {
    return { kicker: t('homeToday'), title: t('homeShiftLoading'), detail: t('homeShiftLoadingDetail'), tone: 'loading' };
  }

  if (input.isWork) {
    const start = input.shiftStartMs;
    const end = input.shiftEndMs;
    if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { kicker: t('homeToday'), title: t('homeShiftWork'), detail: t('homeShiftTimeUnavailable'), tone: 'empty' };
    }
    const fmt = (value: number) => new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const title = `${fmt(start)} – ${fmt(end)}`;
    if (input.nowMs < start) {
      return {
        kicker: input.shiftKind === 'next' ? t('homeNextShift') : t('homeShiftToday'),
        title,
        detail: t('homeShiftStartsIn').replace('{time}', formatDuration(start - input.nowMs)),
        tone: 'next',
      };
    }
    if (input.nowMs < end) {
      return {
        kicker: t('homeInProgress'), title,
        detail: t('homeShiftEndsIn').replace('{time}', formatDuration(end - input.nowMs)),
        tone: 'active',
      };
    }
    return { kicker: t('homeToday'), title, detail: t('homeShiftEnded'), tone: 'ended' };
  }

  if (input.isRest || input.shiftKind === 'rest') {
    return { kicker: t('homeToday'), title: t('homeRestDay'), detail: t('homeRestDetail'), tone: 'rest' };
  }
  return { kicker: t('homeToday'), title: t('homeNoShift'), detail: t('homeNoShiftDetail'), tone: 'empty' };
}

export type HomeAttentionAction = 'calendar-permission' | 'calendar-setup' | 'notification-permission' | 'notification-settings' | 'flights';
export type HomeAttention = {
  titleKey: TranslationKey;
  detailKey: TranslationKey;
  actionKey: TranslationKey;
  action: HomeAttentionAction;
};

export type HomeAttentionInput = {
  calendarPermission: 'unknown' | 'granted' | 'denied';
  calendarAvailable: boolean | null;
  notificationsEnabled: boolean;
  notificationPermissionGranted: boolean | null;
  duplicateNotifications: number;
  hasRelevantFlights: boolean;
  flightStatusLoaded: boolean;
  providerFetchedAt?: number | null;
  nowMs: number;
};

// Surface one actionable issue at a time. Deliberately disabled notifications
// and flight data outside a work shift do not need a warning on Home.
export function buildHomeAttention(input: HomeAttentionInput): HomeAttention | null {
  if (input.calendarPermission === 'denied') {
    return { titleKey: 'homeCalendarAccessTitle', detailKey: 'homeCalendarAccessDetail', actionKey: 'homeAllowCalendar', action: 'calendar-permission' };
  }
  if (input.calendarPermission === 'granted' && input.calendarAvailable === false) {
    return { titleKey: 'homeCalendarMissingTitle', detailKey: 'homeCalendarMissingDetail', actionKey: 'homeCreateCalendar', action: 'calendar-setup' };
  }
  if (input.notificationsEnabled && input.notificationPermissionGranted === false) {
    return { titleKey: 'homeNotificationsBlockedTitle', detailKey: 'homeNotificationsBlockedDetail', actionKey: 'homeAllowNotifications', action: 'notification-permission' };
  }
  if (input.notificationsEnabled && input.duplicateNotifications > 0) {
    return { titleKey: 'homeNotificationsCheckTitle', detailKey: 'homeNotificationsCheckDetail', actionKey: 'homeCheckNotifications', action: 'notification-settings' };
  }
  if (input.hasRelevantFlights && input.flightStatusLoaded) {
    if (!input.providerFetchedAt) {
      return { titleKey: 'homeFlightsMissingTitle', detailKey: 'homeFlightsMissingDetail', actionKey: 'homeOpenFlights', action: 'flights' };
    }
    if (input.nowMs - input.providerFetchedAt > 20 * 60_000) {
      return { titleKey: 'homeFlightsStaleTitle', detailKey: 'homeFlightsStaleDetail', actionKey: 'homeOpenFlights', action: 'flights' };
    }
  }
  return null;
}
