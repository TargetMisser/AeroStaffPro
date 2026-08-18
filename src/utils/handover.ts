export type HandoverScope = 'shift' | 'flight';

export type HandoverEntry = {
  id: string;
  shiftDate: string;
  scope: HandoverScope;
  flightNumber?: string;
  direction?: 'arrival' | 'departure';
  note: string;
  checklist: string[];
  createdAt: number;
};

export const HANDOVER_STORAGE_KEY = 'aerostaff_handover_v1';

export const HANDOVER_CHECKLIST = [
  'Documenti verificati',
  'DCS aggiornato',
  'Consegna completata',
] as const;

export function parseHandoverEntries(raw: string | null | undefined): HandoverEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(entry => (
      entry
      && typeof entry.id === 'string'
      && typeof entry.shiftDate === 'string'
      && (entry.scope === 'shift' || entry.scope === 'flight')
      && typeof entry.note === 'string'
      && Array.isArray(entry.checklist)
      && typeof entry.createdAt === 'number'
    ));
  } catch {
    return [];
  }
}

export function createHandoverEntry(
  input: Omit<HandoverEntry, 'id' | 'createdAt'>,
  now = Date.now(),
): HandoverEntry {
  return {
    ...input,
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };
}

export function buildHandoverSummary(entries: HandoverEntry[], shiftDate: string): string {
  const selected = entries
    .filter(entry => entry.shiftDate === shiftDate)
    .sort((left, right) => left.createdAt - right.createdAt);
  const lines = [`AeroStaff Pro - Passaggio consegne ${shiftDate.split('-').reverse().join('/')}`];
  if (selected.length === 0) return `${lines[0]}\nNessuna consegna registrata.`;

  selected.forEach((entry, index) => {
    const scope = entry.scope === 'flight'
      ? `Volo ${entry.flightNumber ?? 'N/D'}${entry.direction ? ` (${entry.direction === 'arrival' ? 'arrivo' : 'partenza'})` : ''}`
      : 'Turno';
    lines.push('', `${index + 1}. ${scope}`, entry.note.trim() || 'Nessuna nota');
    if (entry.checklist.length > 0) lines.push(`Completato: ${entry.checklist.join(', ')}`);
  });
  return lines.join('\n');
}
