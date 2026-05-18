import { formatFlightSourceLabel } from './flightSourceLabel';

export type HomeOperationalTone = 'active' | 'next' | 'rest' | 'empty' | 'loading';
export type HomeHealthTone = 'ready' | 'attention' | 'missing';

export type HomeOperationalSummaryInput = {
  loadingShift: boolean;
  shiftKind: 'today' | 'next' | 'rest' | 'none';
  isWork: boolean;
  isRest: boolean;
  shiftStartMs?: number | null;
  shiftEndMs?: number | null;
  nowMs: number;
  hasPinnedFlight: boolean;
};

export type HomeOperationalSummary = {
  kicker: string;
  title: string;
  detail: string;
  tone: HomeOperationalTone;
  badges: string[];
};

export type HomeHealthInput = {
  providerLabel?: string | null;
  providerFetchedAt?: number | null;
  notificationsEnabled: boolean;
  pendingNotifications: number;
  duplicateNotifications: number;
  airportCode: string;
  nowMs: number;
};

export type HomeHealthChip = {
  id: 'airport' | 'flights' | 'notifications' | 'widget';
  label: string;
  value: string;
  tone: HomeHealthTone;
};

function formatTimeRange(startMs?: number | null, endMs?: number | null): string {
  if (!startMs || !endMs) {
    return 'Orario non disponibile';
  }

  const fmt = (value: number) => new Date(value).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${fmt(startMs)} - ${fmt(endMs)}`;
}

function minutesAgo(nowMs: number, thenMs: number): number {
  return Math.max(0, Math.round((nowMs - thenMs) / 60000));
}

export function buildHomeOperationalSummary(input: HomeOperationalSummaryInput): HomeOperationalSummary {
  const badges = input.hasPinnedFlight ? ['Volo pinnato'] : [];

  if (input.loadingShift) {
    return {
      kicker: 'ADESSO',
      title: 'Sincronizzo turni',
      detail: 'Controllo calendario e widget.',
      tone: 'loading',
      badges,
    };
  }

  if (input.isWork && input.shiftKind === 'today') {
    return {
      kicker: 'ADESSO',
      title: 'Turno in corso',
      detail: formatTimeRange(input.shiftStartMs, input.shiftEndMs),
      tone: 'active',
      badges,
    };
  }

  if (input.isWork && input.shiftKind === 'next') {
    return {
      kicker: 'PROSSIMO',
      title: 'Prossimo turno',
      detail: formatTimeRange(input.shiftStartMs, input.shiftEndMs),
      tone: 'next',
      badges,
    };
  }

  if (input.isRest || input.shiftKind === 'rest') {
    return {
      kicker: 'OGGI',
      title: 'Riposo',
      detail: 'Nessun turno operativo previsto.',
      tone: 'rest',
      badges,
    };
  }

  return {
    kicker: 'ADESSO',
    title: 'Nessun turno attivo',
    detail: 'Importa o aggiungi i turni per rendere utile la Home.',
    tone: 'empty',
    badges,
  };
}

export function buildHomeHealthChips(input: HomeHealthInput): HomeHealthChip[] {
  const providerAgeMin = input.providerFetchedAt ? minutesAgo(input.nowMs, input.providerFetchedAt) : null;
  const providerFresh = providerAgeMin !== null && providerAgeMin <= 20;
  const providerValue = input.providerLabel
    ? `${formatFlightSourceLabel(input.providerLabel)}${providerAgeMin !== null ? ` · ${providerAgeMin}m` : ''}`
    : 'Nessun dato';

  return [
    {
      id: 'airport',
      label: 'Aeroporto',
      value: input.airportCode,
      tone: input.airportCode ? 'ready' : 'missing',
    },
    {
      id: 'flights',
      label: 'Voli',
      value: providerValue,
      tone: input.providerLabel ? (providerFresh ? 'ready' : 'attention') : 'missing',
    },
    {
      id: 'notifications',
      label: 'Notifiche',
      value: input.notificationsEnabled
        ? `${input.pendingNotifications} attive`
        : 'Spente',
      tone: input.duplicateNotifications > 0
        ? 'missing'
        : input.notificationsEnabled
          ? 'ready'
          : 'attention',
    },
    {
      id: 'widget',
      label: 'Widget',
      value: 'Sync Home',
      tone: 'ready',
    },
  ];
}
