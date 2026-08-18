export type ComparableShift = {
  date: string;
  type: 'work' | 'rest';
  startTime?: string;
  endTime?: string;
};

export type ShiftImportChangeKind = 'new' | 'unchanged' | 'replace';

export type ShiftImportPreviewRow = {
  shift: ComparableShift;
  existing: ComparableShift | null;
  kind: ShiftImportChangeKind;
};

export type ShiftImportPreview = {
  rows: ShiftImportPreviewRow[];
  newCount: number;
  unchangedCount: number;
  replaceCount: number;
};

function normalizeTime(value?: string): string | undefined {
  if (!value) return undefined;
  const [hour = '', minute = ''] = value.split(':');
  if (!hour || !minute) return undefined;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function shiftsMatch(left: ComparableShift, right: ComparableShift): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'rest') return true;
  return normalizeTime(left.startTime) === normalizeTime(right.startTime)
    && normalizeTime(left.endTime) === normalizeTime(right.endTime);
}

export function analyzeShiftImport(
  importedShifts: ComparableShift[],
  existingShifts: ComparableShift[],
): ShiftImportPreview {
  const existingByDate = new Map(existingShifts.map(shift => [shift.date, shift]));
  const rows = importedShifts.map(shift => {
    const existing = existingByDate.get(shift.date) ?? null;
    const kind: ShiftImportChangeKind = !existing
      ? 'new'
      : shiftsMatch(shift, existing)
        ? 'unchanged'
        : 'replace';
    return { shift, existing, kind };
  });

  return {
    rows,
    newCount: rows.filter(row => row.kind === 'new').length,
    unchangedCount: rows.filter(row => row.kind === 'unchanged').length,
    replaceCount: rows.filter(row => row.kind === 'replace').length,
  };
}

export function formatComparableShift(shift: ComparableShift | null): string {
  if (!shift) return '-';
  if (shift.type === 'rest') return 'Riposo';
  return `${normalizeTime(shift.startTime) ?? '--:--'} - ${normalizeTime(shift.endTime) ?? '--:--'}`;
}
