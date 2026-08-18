export type ShareableShiftEvent = {
  title: string;
  startDate: string | Date;
  endDate: string | Date;
};

export type ShiftShareOptions = {
  eventsByDate: Record<string, ShareableShiftEvent[]>;
  startIso: string;
  endIso: string;
  locale: string;
  title: string;
};

function fromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function eachDate(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cursor = fromIso(startIso);
  const end = fromIso(endIso);
  while (cursor <= end) {
    dates.push(toLocalIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatTime(value: string | Date, locale: string): string {
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsDateTime(value: string | Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`;
}

function icsDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function icsUtcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function nextIso(iso: string): string {
  const next = fromIso(iso);
  next.setDate(next.getDate() + 1);
  return toLocalIso(next);
}

export function buildShiftShareText(options: ShiftShareOptions): string {
  const { eventsByDate, startIso, endIso, locale, title } = options;
  const lines = [`AeroStaff Pro - ${title}`];

  for (const iso of eachDate(startIso, endIso)) {
    const events = eventsByDate[iso] ?? [];
    const work = events.find(event => event.title.includes('Lavoro'));
    const rest = events.find(event => event.title.includes('Riposo'));
    const dateLabel = fromIso(iso).toLocaleDateString(locale, {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    });
    if (work) lines.push(`${dateLabel}: ${formatTime(work.startDate, locale)} - ${formatTime(work.endDate, locale)}`);
    else if (rest) lines.push(`${dateLabel}: Riposo`);
    else lines.push(`${dateLabel}: Nessun turno`);
  }

  return lines.join('\n');
}

export function buildShiftIcs(options: ShiftShareOptions): string {
  const { eventsByDate, startIso, endIso, title } = options;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AeroStaff Pro//Turni//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(title)}`,
  ];

  for (const iso of eachDate(startIso, endIso)) {
    const events = eventsByDate[iso] ?? [];
    const event = events.find(item => item.title.includes('Lavoro'))
      ?? events.find(item => item.title.includes('Riposo'));
    if (!event) continue;

    const isRest = event.title.includes('Riposo');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:aerostaff-${iso}-${isRest ? 'rest' : 'work'}@local`);
    lines.push(`DTSTAMP:${icsUtcTimestamp()}`);
    lines.push(`SUMMARY:${escapeIcs(isRest ? 'Riposo' : 'Lavoro')}`);
    lines.push('STATUS:CONFIRMED');
    if (isRest) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(iso)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(nextIso(iso))}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Rome:${icsDateTime(event.startDate)}`);
      lines.push(`DTEND;TZID=Europe/Rome:${icsDateTime(event.endDate)}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
