export const ONBOARDING_SETUP_STORAGE_KEY = 'aerostaff_onboarding_completed_v1';

export type SetupPermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';
export type SetupItemStatus = 'ready' | 'attention' | 'missing';
export type SetupItemId = 'profile' | 'calendar' | 'flightData' | 'notifications' | 'widget';

export type SetupChecklistInput = {
  hasProfile: boolean;
  airportLabel: string;
  calendarPermission: SetupPermissionState;
  notificationPermission: SetupPermissionState;
  notificationsEnabled: boolean;
  providerPreference: string;
  hasAeroDataBoxKey: boolean;
  hasFr24Key: boolean;
  hasAirLabsKey: boolean;
  pendingNotifications: number;
  duplicateNotifications: number;
};

export type SetupChecklistItem = {
  id: SetupItemId;
  title: string;
  detail: string;
  status: SetupItemStatus;
  required: boolean;
};

export type SetupChecklist = {
  items: SetupChecklistItem[];
  requiredComplete: boolean;
  readyCount: number;
  totalCount: number;
};

function permissionReady(value: SetupPermissionState): boolean {
  return value === 'granted';
}

function permissionDenied(value: SetupPermissionState): boolean {
  return value === 'denied';
}

export function shouldShowOnboarding(storedValue: string | null | undefined): boolean {
  return storedValue !== 'true';
}

export function buildSetupChecklist(input: SetupChecklistInput): SetupChecklist {
  const hasAnyApiKey = input.hasAeroDataBoxKey || input.hasFr24Key || input.hasAirLabsKey;
  const providerDetail = hasAnyApiKey
    ? [
      input.hasFr24Key ? 'FR24' : null,
      input.hasAeroDataBoxKey ? 'AeroDataBox' : null,
      input.hasAirLabsKey ? 'AirLabs' : null,
    ].filter(Boolean).join(' + ')
    : input.providerPreference === 'staffMonitor'
      ? 'StaffMonitor PSA configurato come fallback operativo'
      : 'Auto: usa fallback pubblici e StaffMonitor quando disponibili';

  const notificationReady = permissionReady(input.notificationPermission) && input.notificationsEnabled;
  const notificationDetail = notificationReady
    ? `${input.pendingNotifications} programmate`
    : permissionDenied(input.notificationPermission)
      ? 'Permesso notifiche negato'
      : 'Da attivare quando vuoi ricevere alert voli/turni';

  const items: SetupChecklistItem[] = [
    {
      id: 'profile',
      title: 'Profilo aeroportuale',
      detail: input.hasProfile ? input.airportLabel : 'Crea almeno un profilo operativo',
      status: input.hasProfile ? 'ready' : 'missing',
      required: true,
    },
    {
      id: 'calendar',
      title: 'Calendario turni',
      detail: permissionReady(input.calendarPermission)
        ? 'Permesso calendario attivo'
        : permissionDenied(input.calendarPermission)
          ? 'Permesso calendario negato'
          : 'Serve per leggere e salvare i turni',
      status: permissionReady(input.calendarPermission)
        ? 'ready'
        : permissionDenied(input.calendarPermission)
          ? 'missing'
          : 'attention',
      required: true,
    },
    {
      id: 'flightData',
      title: 'Fonti voli',
      detail: providerDetail,
      status: hasAnyApiKey || input.providerPreference === 'staffMonitor' || input.providerPreference === 'auto'
        ? 'ready'
        : 'attention',
      required: false,
    },
    {
      id: 'notifications',
      title: 'Notifiche',
      detail: input.duplicateNotifications > 0
        ? `${input.duplicateNotifications} duplicati da controllare`
        : notificationDetail,
      status: notificationReady
        ? 'ready'
        : input.duplicateNotifications > 0 || permissionDenied(input.notificationPermission)
          ? 'missing'
          : 'attention',
      required: false,
    },
    {
      id: 'widget',
      title: 'Widget',
      detail: 'Aggiungilo dalla schermata Home di Android e usera questi dati',
      status: 'attention',
      required: false,
    },
  ];

  const requiredComplete = items
    .filter(item => item.required)
    .every(item => item.status === 'ready');

  return {
    items,
    requiredComplete,
    readyCount: items.filter(item => item.status === 'ready').length,
    totalCount: items.length,
  };
}
