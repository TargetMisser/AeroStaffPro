export type PrintableShiftEvent = {
  title: string;
  startDate: string | Date;
  endDate: string | Date;
};

export type PrintableShiftCalendarCopy = {
  title: string;
  work: string;
  rest: string;
  noShift: string;
  totalHours: string;
  workShifts: string;
  restDays: string;
  generatedBy: string;
};

export type PrintableShiftCalendarOptions = {
  month: Date;
  eventsByDate: Record<string, PrintableShiftEvent[]>;
  locale: string;
  monthNames: string[];
  weekDaysMondayFirst: string[];
  copy: PrintableShiftCalendarCopy;
};

export type PrintableShiftCalendarSummary = {
  totalMinutes: number;
  workShifts: number;
  restDays: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(dateValue: string | Date, locale: string): string {
  return new Date(dateValue).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getShiftDurationMinutes(event: PrintableShiftEvent): number {
  return Math.max(
    0,
    Math.round((new Date(event.endDate).getTime() - new Date(event.startDate).getTime()) / 60000),
  );
}

export function summarizePrintableShiftMonth(
  month: Date,
  eventsByDate: Record<string, PrintableShiftEvent[]>,
): PrintableShiftCalendarSummary {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  let totalMinutes = 0;
  let workShifts = 0;
  let restDays = 0;

  for (const [iso, events] of Object.entries(eventsByDate)) {
    const eventDate = new Date(`${iso}T00:00:00`);
    if (eventDate.getFullYear() !== year || eventDate.getMonth() !== monthIndex) continue;

    const workEvent = events.find(event => event.title.includes('Lavoro'));
    const restEvent = events.find(event => event.title.includes('Riposo'));
    if (workEvent) {
      totalMinutes += getShiftDurationMinutes(workEvent);
      workShifts += 1;
    } else if (restEvent) {
      restDays += 1;
    }
  }

  return { totalMinutes, workShifts, restDays };
}

function buildDayCells({
  month,
  eventsByDate,
  locale,
  copy,
}: Pick<PrintableShiftCalendarOptions, 'month' | 'eventsByDate' | 'locale' | 'copy'>): string {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const leadingBlankDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: string[] = [];

  for (let index = 0; index < 42; index += 1) {
    const dayNumber = index - leadingBlankDays + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cells.push('<div class="day day--blank"></div>');
      continue;
    }

    const date = new Date(year, monthIndex, dayNumber);
    const iso = toLocalIso(date);
    const events = eventsByDate[iso] ?? [];
    const workEvent = events.find(event => event.title.includes('Lavoro'));
    const restEvent = events.find(event => event.title.includes('Riposo'));
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    let shiftHtml = `<div class="no-shift">${escapeHtml(copy.noShift)}</div>`;
    let cellClass = '';
    if (workEvent) {
      const start = formatTime(workEvent.startDate, locale);
      const end = formatTime(workEvent.endDate, locale);
      const duration = getShiftDurationMinutes(workEvent);
      shiftHtml = `
        <div class="shift shift--work">
          <div class="shift__label">${escapeHtml(copy.work)}</div>
          <div class="shift__time">${escapeHtml(start)} - ${escapeHtml(end)}</div>
          <div class="shift__duration">${(duration / 60).toFixed(1)} h</div>
        </div>`;
      cellClass = ' day--work';
    } else if (restEvent) {
      shiftHtml = `
        <div class="shift shift--rest">
          <div class="shift__label">${escapeHtml(copy.rest)}</div>
        </div>`;
      cellClass = ' day--rest';
    }

    cells.push(`
      <div class="day${cellClass}${isWeekend ? ' day--weekend' : ''}">
        <div class="day__number">${dayNumber}</div>
        ${shiftHtml}
      </div>`);
  }

  return cells.join('');
}

export function buildPrintableShiftCalendarHtml(options: PrintableShiftCalendarOptions): string {
  const {
    month,
    eventsByDate,
    locale,
    monthNames,
    weekDaysMondayFirst,
    copy,
  } = options;
  const summary = summarizePrintableShiftMonth(month, eventsByDate);
  const monthLabel = `${monthNames[month.getMonth()]} ${month.getFullYear()}`;
  const weekdayHeaders = weekDaysMondayFirst
    .map(day => `<div class="weekday">${escapeHtml(day)}</div>`)
    .join('');
  const dayCells = buildDayCells({ month, eventsByDate, locale, copy });

  return `<!doctype html>
<html lang="${escapeHtml(locale.split('-')[0] || 'it')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.title)} - ${escapeHtml(monthLabel)}</title>
  <style>
    @page { size: A4 landscape; margin: 9mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      color: #172033;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { width: 100%; }
    .header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      border-bottom: 2.2mm solid #f47b16;
      padding: 0 0 3.2mm;
      margin-bottom: 3.2mm;
    }
    .brand {
      color: #c2520a;
      font-size: 9pt;
      font-weight: 800;
      letter-spacing: 1.4pt;
      text-transform: uppercase;
    }
    h1 {
      margin: 1.2mm 0 0;
      font-size: 24pt;
      line-height: 1;
      letter-spacing: -0.4pt;
      text-transform: capitalize;
    }
    .summary {
      display: flex;
      gap: 2.5mm;
      align-items: stretch;
    }
    .summary__item {
      min-width: 29mm;
      padding: 2.2mm 3mm;
      background: #fff7ed;
      border: 0.35mm solid #fed7aa;
      border-radius: 2mm;
      text-align: right;
    }
    .summary__value {
      color: #9a3412;
      font-size: 12pt;
      font-weight: 800;
      line-height: 1.05;
    }
    .summary__label {
      margin-top: 0.8mm;
      color: #596274;
      font-size: 6.6pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.35pt;
    }
    .weekdays, .calendar {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
    }
    .weekdays {
      border: 0.35mm solid #cbd5e1;
      border-bottom: 0;
      border-radius: 2mm 2mm 0 0;
      overflow: hidden;
    }
    .weekday {
      padding: 1.8mm 1.4mm;
      background: #172033;
      color: #fff;
      border-right: 0.25mm solid #475569;
      font-size: 7pt;
      font-weight: 800;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.45pt;
    }
    .weekday:last-child { border-right: 0; }
    .calendar {
      height: 143mm;
      grid-template-rows: repeat(6, 1fr);
      border-left: 0.35mm solid #cbd5e1;
      border-top: 0.35mm solid #cbd5e1;
    }
    .day {
      position: relative;
      min-width: 0;
      padding: 2mm;
      border-right: 0.35mm solid #cbd5e1;
      border-bottom: 0.35mm solid #cbd5e1;
      background: #fff;
      overflow: hidden;
    }
    .day--blank { background: #f8fafc; }
    .day--weekend:not(.day--work):not(.day--rest) { background: #fbfcfe; }
    .day--work { background: #fffaf5; }
    .day--rest { background: #f0fdfa; }
    .day__number {
      color: #334155;
      font-size: 9pt;
      font-weight: 800;
      line-height: 1;
    }
    .shift {
      margin-top: 1.7mm;
      padding-left: 2mm;
      border-left: 1.2mm solid;
    }
    .shift--work { border-color: #f47b16; }
    .shift--rest { border-color: #0f766e; }
    .shift__label {
      font-size: 6.4pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.35pt;
    }
    .shift--work .shift__label { color: #c2520a; }
    .shift--rest .shift__label { color: #0f766e; }
    .shift__time {
      margin-top: 1mm;
      color: #172033;
      font-size: 9.2pt;
      font-weight: 800;
      white-space: nowrap;
    }
    .shift__duration {
      margin-top: 0.5mm;
      color: #64748b;
      font-size: 6.2pt;
      font-weight: 700;
    }
    .no-shift {
      margin-top: 2mm;
      color: #a1a8b5;
      font-size: 6.2pt;
      font-weight: 600;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 2.2mm;
      color: #64748b;
      font-size: 6.2pt;
    }
    .legend { display: flex; gap: 4mm; }
    .legend__item { display: flex; align-items: center; gap: 1.2mm; }
    .legend__dot { width: 2.2mm; height: 2.2mm; border-radius: 50%; }
    .legend__dot--work { background: #f47b16; }
    .legend__dot--rest { background: #0f766e; }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <div class="brand">AeroStaff Pro</div>
      <h1>${escapeHtml(monthLabel)}</h1>
    </div>
    <div class="summary">
      <div class="summary__item">
        <div class="summary__value">${(summary.totalMinutes / 60).toFixed(1)} h</div>
        <div class="summary__label">${escapeHtml(copy.totalHours)}</div>
      </div>
      <div class="summary__item">
        <div class="summary__value">${summary.workShifts}</div>
        <div class="summary__label">${escapeHtml(copy.workShifts)}</div>
      </div>
      <div class="summary__item">
        <div class="summary__value">${summary.restDays}</div>
        <div class="summary__label">${escapeHtml(copy.restDays)}</div>
      </div>
    </div>
  </header>
  <section class="weekdays">${weekdayHeaders}</section>
  <section class="calendar">${dayCells}</section>
  <footer class="footer">
    <div class="legend">
      <div class="legend__item"><span class="legend__dot legend__dot--work"></span>${escapeHtml(copy.work)}</div>
      <div class="legend__item"><span class="legend__dot legend__dot--rest"></span>${escapeHtml(copy.rest)}</div>
    </div>
    <div>${escapeHtml(copy.generatedBy)}</div>
  </footer>
</body>
</html>`;
}
