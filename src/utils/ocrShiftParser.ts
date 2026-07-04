export type OcrParsedShift = {
  date: string;
  type: 'work' | 'rest';
  startTime?: string;
  endTime?: string;
};

export type OcrShiftParseResult = {
  shifts: OcrParsedShift[];
  datesFound: number;
  shiftsFound: number;
  strategy: 'line' | 'segment' | 'zip' | 'none';
  warning?: string;
};

type OcrDateToken = {
  day: number;
  month: number;
  year: number;
  raw: string;
  index: number;
};

type OcrShiftToken = {
  isRest: boolean;
  raw: string;
  index: number;
  startH?: number;
  startM?: number;
  endH?: number;
  endM?: number;
};

const DATE_REGEX = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g;
const SHIFT_REGEX = /\b([01]?\d|2[0-3])\s*[,.:;]\s*([0-5]\d)\s*[-–—_~|]+\s*([01]?\d|2[0-3])\s*[,.:;]\s*([0-5]\d)\b|\b(R|RIP|RIP0S0|R1P0S0|R1POSO|RIPOSO|FERIE|FER1E|F)\b/gi;

function normalizeDateCandidates(text: string): string {
  const CANDIDATE_DATE_REGEX = /\b[0-9OoQIl|]{1,2}[\/\-][0-9OoQIl|]{1,2}(?:[\/\-][0-9OoQIl|]{2,4})?\b/gi;
  return text.replace(CANDIDATE_DATE_REGEX, (match) => {
    return match
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1');
  });
}

function normalizeShiftCandidates(text: string): string {
  const CANDIDATE_TIME_REGEX = /\b[0-9OoQIl|]{1,2}\s*[,.:;]\s*[0-9OoQIl|]{2}\s*[-–—_~|]+\s*[0-9OoQIl|]{1,2}\s*[,.:;]\s*[0-9OoQIl|]{2}\b/gi;
  return text.replace(CANDIDATE_TIME_REGEX, (match) => {
    return match
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1');
  });
}

function normalizeOcrText(text: string): string {
  let normalized = normalizeDateCandidates(text);
  normalized = normalizeShiftCandidates(normalized);
  return normalized.replace(/\u00A0/g, ' ');
}

function normalizeYear(value: string | undefined, fallbackYear: number): number {
  if (!value) return fallbackYear;
  const year = Number(value);
  if (!Number.isFinite(year)) return fallbackYear;
  return year < 100 ? 2000 + year : year;
}

function isValidDateToken(day: number, month: number, year: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function toIsoDate(token: OcrDateToken): string {
  return `${token.year}-${String(token.month).padStart(2, '0')}-${String(token.day).padStart(2, '0')}`;
}

function toParsedShift(date: OcrDateToken, shift: OcrShiftToken): OcrParsedShift {
  if (shift.isRest) {
    return { date: toIsoDate(date), type: 'rest' };
  }

  return {
    date: toIsoDate(date),
    type: 'work',
    startTime: `${String(shift.startH).padStart(2, '0')}:${String(shift.startM).padStart(2, '0')}`,
    endTime: `${String(shift.endH).padStart(2, '0')}:${String(shift.endM).padStart(2, '0')}`,
  };
}

function parseDates(text: string, baseYear: number): OcrDateToken[] {
  const tokens: OcrDateToken[] = [];
  let match: RegExpExecArray | null;
  DATE_REGEX.lastIndex = 0;

  while ((match = DATE_REGEX.exec(text)) !== null) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = normalizeYear(match[3], baseYear);
    if (!isValidDateToken(day, month, year)) continue;
    tokens.push({ day, month, year, raw: match[0], index: match.index });
  }

  return tokens;
}

function parseShifts(text: string): OcrShiftToken[] {
  const safeText = text.replace(/\b20\d{2}\b/g, ' ANNO ');
  const tokens: OcrShiftToken[] = [];
  let match: RegExpExecArray | null;
  SHIFT_REGEX.lastIndex = 0;

  while ((match = SHIFT_REGEX.exec(safeText)) !== null) {
    if (match[5]) {
      tokens.push({ isRest: true, raw: match[0], index: match.index });
      continue;
    }

    tokens.push({
      isRest: false,
      raw: match[0],
      index: match.index,
      startH: Number(match[1]),
      startM: Number(match[2]),
      endH: Number(match[3]),
      endM: Number(match[4]),
    });
  }

  return tokens;
}

function parseLinePairs(text: string, baseYear: number): OcrParsedShift[] {
  const result: OcrParsedShift[] = [];

  for (const line of text.split(/\r?\n/)) {
    const dates = parseDates(line, baseYear);
    const shifts = parseShifts(line);
    if (dates.length === 0 || shifts.length === 0) continue;

    const count = Math.min(dates.length, shifts.length);
    for (let i = 0; i < count; i += 1) {
      result.push(toParsedShift(dates[i], shifts[i]));
    }
  }

  return result;
}

function parseSegmentPairs(dates: OcrDateToken[], shifts: OcrShiftToken[]): OcrParsedShift[] {
  const result: OcrParsedShift[] = [];

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const nextDate = dates[i + 1];
    const matches = shifts.filter(shift =>
      shift.index > date.index && (!nextDate || shift.index < nextDate.index),
    );

    if (matches.length === 1) {
      result.push(toParsedShift(date, matches[0]));
    }
  }

  return result;
}

function parseZipPairs(dates: OcrDateToken[], shifts: OcrShiftToken[]): OcrParsedShift[] {
  if (dates.length !== shifts.length) {
    return [];
  }

  return dates.map((date, index) => toParsedShift(date, shifts[index]));
}

function uniqueByDate(shifts: OcrParsedShift[]): OcrParsedShift[] {
  const seen = new Set<string>();
  return shifts.filter(shift => {
    if (seen.has(shift.date)) return false;
    seen.add(shift.date);
    return true;
  });
}

export function parseOcrShiftText(text: string, baseYear = new Date().getFullYear()): OcrShiftParseResult {
  const normalized = normalizeOcrText(text);
  const dates = parseDates(normalized, baseYear);
  const shifts = parseShifts(normalized);

  if (dates.length === 0 || shifts.length === 0) {
    return {
      shifts: [],
      datesFound: dates.length,
      shiftsFound: shifts.length,
      strategy: 'none',
      warning: 'Nessuna data o nessun turno riconosciuto.',
    };
  }

  const linePairs = uniqueByDate(parseLinePairs(normalized, baseYear));
  if (linePairs.length === dates.length) {
    return { shifts: linePairs, datesFound: dates.length, shiftsFound: shifts.length, strategy: 'line' };
  }

  const segmentPairs = uniqueByDate(parseSegmentPairs(dates, shifts));
  if (segmentPairs.length === dates.length) {
    return { shifts: segmentPairs, datesFound: dates.length, shiftsFound: shifts.length, strategy: 'segment' };
  }

  const zipPairs = parseZipPairs(dates, shifts);
  if (zipPairs.length > 0) {
    return { shifts: zipPairs, datesFound: dates.length, shiftsFound: shifts.length, strategy: 'zip' };
  }

  return {
    shifts: [],
    datesFound: dates.length,
    shiftsFound: shifts.length,
    strategy: 'none',
    warning: `Date e turni non combaciano (${dates.length} date, ${shifts.length} turni). Import annullato per evitare slittamenti.`,
  };
}
