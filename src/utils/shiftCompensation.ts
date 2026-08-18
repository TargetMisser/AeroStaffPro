export const COMPENSATION_RULES_KEY = 'aerostaff_compensation_rules_v1';

export type CompensationRules = {
  hourlyRate: number;
  nightBonusPercent: number;
  holidayBonusPercent: number;
  overtimeBonusPercent: number;
  dailyOvertimeThresholdHours: number;
};

export const DEFAULT_COMPENSATION_RULES: CompensationRules = {
  hourlyRate: 10,
  nightBonusPercent: 25,
  holidayBonusPercent: 30,
  overtimeBonusPercent: 25,
  dailyOvertimeThresholdHours: 8,
};

export type CompensationShiftEvent = {
  title: string;
  startDate: string | Date;
  endDate: string | Date;
};

export type CompensationShiftBreakdown = {
  date: string;
  startDate: Date;
  endDate: Date;
  totalMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  overtimeMinutes: number;
  estimatedAmount: number;
};

export type CompensationSummary = {
  shifts: CompensationShiftBreakdown[];
  totalMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  overtimeMinutes: number;
  baseAmount: number;
  nightBonusAmount: number;
  holidayBonusAmount: number;
  overtimeBonusAmount: number;
  estimatedAmount: number;
};

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeCompensationRules(value: unknown): CompensationRules {
  const parsed = value && typeof value === 'object' ? value as Partial<CompensationRules> : {};
  return {
    hourlyRate: finiteNumber(parsed.hourlyRate, DEFAULT_COMPENSATION_RULES.hourlyRate, 0, 500),
    nightBonusPercent: finiteNumber(parsed.nightBonusPercent, DEFAULT_COMPENSATION_RULES.nightBonusPercent, 0, 300),
    holidayBonusPercent: finiteNumber(parsed.holidayBonusPercent, DEFAULT_COMPENSATION_RULES.holidayBonusPercent, 0, 300),
    overtimeBonusPercent: finiteNumber(parsed.overtimeBonusPercent, DEFAULT_COMPENSATION_RULES.overtimeBonusPercent, 0, 300),
    dailyOvertimeThresholdHours: finiteNumber(parsed.dailyOvertimeThresholdHours, DEFAULT_COMPENSATION_RULES.dailyOvertimeThresholdHours, 1, 24),
  };
}

export function parseCompensationRules(raw: string | null | undefined): CompensationRules {
  if (!raw) return DEFAULT_COMPENSATION_RULES;
  try {
    return normalizeCompensationRules(JSON.parse(raw));
  } catch {
    return DEFAULT_COMPENSATION_RULES;
  }
}

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const FIXED_ITALIAN_HOLIDAYS = new Set([
  '01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26',
]);

function isHolidayMinute(date: Date): boolean {
  const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return date.getDay() === 0 || FIXED_ITALIAN_HOLIDAYS.has(key);
}

function countSpecialMinutes(startDate: Date, endDate: Date): { nightMinutes: number; holidayMinutes: number } {
  let nightMinutes = 0;
  let holidayMinutes = 0;
  for (let cursor = startDate.getTime(); cursor < endDate.getTime(); cursor += 60_000) {
    const minute = new Date(cursor);
    if (minute.getHours() >= 22 || minute.getHours() < 6) nightMinutes += 1;
    if (isHolidayMinute(minute)) holidayMinutes += 1;
  }
  return { nightMinutes, holidayMinutes };
}

export function summarizeCompensationMonth(
  month: Date,
  eventsByDate: Record<string, CompensationShiftEvent[]>,
  rulesInput: CompensationRules,
): CompensationSummary {
  const rules = normalizeCompensationRules(rulesInput);
  const shifts: CompensationShiftBreakdown[] = [];

  for (const [date, events] of Object.entries(eventsByDate)) {
    const day = new Date(`${date}T00:00:00`);
    if (day.getFullYear() !== month.getFullYear() || day.getMonth() !== month.getMonth()) continue;
    const event = events.find(item => item.title.includes('Lavoro'));
    if (!event) continue;
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    const totalMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60_000));
    if (totalMinutes <= 0) continue;
    const { nightMinutes, holidayMinutes } = countSpecialMinutes(startDate, endDate);
    const overtimeMinutes = Math.max(0, totalMinutes - Math.round(rules.dailyOvertimeThresholdHours * 60));
    const base = totalMinutes / 60 * rules.hourlyRate;
    const bonuses = nightMinutes / 60 * rules.hourlyRate * rules.nightBonusPercent / 100
      + holidayMinutes / 60 * rules.hourlyRate * rules.holidayBonusPercent / 100
      + overtimeMinutes / 60 * rules.hourlyRate * rules.overtimeBonusPercent / 100;
    shifts.push({
      date,
      startDate,
      endDate,
      totalMinutes,
      nightMinutes,
      holidayMinutes,
      overtimeMinutes,
      estimatedAmount: base + bonuses,
    });
  }

  shifts.sort((left, right) => left.date.localeCompare(right.date));
  const totalMinutes = shifts.reduce((sum, shift) => sum + shift.totalMinutes, 0);
  const nightMinutes = shifts.reduce((sum, shift) => sum + shift.nightMinutes, 0);
  const holidayMinutes = shifts.reduce((sum, shift) => sum + shift.holidayMinutes, 0);
  const overtimeMinutes = shifts.reduce((sum, shift) => sum + shift.overtimeMinutes, 0);
  const baseAmount = totalMinutes / 60 * rules.hourlyRate;
  const nightBonusAmount = nightMinutes / 60 * rules.hourlyRate * rules.nightBonusPercent / 100;
  const holidayBonusAmount = holidayMinutes / 60 * rules.hourlyRate * rules.holidayBonusPercent / 100;
  const overtimeBonusAmount = overtimeMinutes / 60 * rules.hourlyRate * rules.overtimeBonusPercent / 100;

  return {
    shifts,
    totalMinutes,
    nightMinutes,
    holidayMinutes,
    overtimeMinutes,
    baseAmount,
    nightBonusAmount,
    holidayBonusAmount,
    overtimeBonusAmount,
    estimatedAmount: baseAmount + nightBonusAmount + holidayBonusAmount + overtimeBonusAmount,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value: number, locale: string): string {
  return value.toLocaleString(locale, { style: 'currency', currency: 'EUR' });
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

export function buildCompensationCsv(
  month: Date,
  summary: CompensationSummary,
  rules: CompensationRules,
  locale = 'it-IT',
): string {
  const lines = [
    'Data;Inizio;Fine;Ore;Notturne;Festive;Straordinario;Stima EUR',
    ...summary.shifts.map(shift => [
      shift.date.split('-').reverse().join('/'),
      shift.startDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      shift.endDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      (shift.totalMinutes / 60).toFixed(2),
      (shift.nightMinutes / 60).toFixed(2),
      (shift.holidayMinutes / 60).toFixed(2),
      (shift.overtimeMinutes / 60).toFixed(2),
      shift.estimatedAmount.toFixed(2),
    ].join(';')),
    '',
    `Mese;${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
    `Paga oraria;${rules.hourlyRate.toFixed(2)}`,
    `Totale ore;${(summary.totalMinutes / 60).toFixed(2)}`,
    `Stima totale;${summary.estimatedAmount.toFixed(2)}`,
    'Nota;Stima personale non sostitutiva della busta paga',
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildCompensationReportHtml(
  month: Date,
  summary: CompensationSummary,
  rules: CompensationRules,
  locale: string,
  monthLabel: string,
): string {
  const rows = summary.shifts.map(shift => `
    <tr>
      <td>${escapeHtml(new Date(`${shift.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }))}</td>
      <td>${escapeHtml(shift.startDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))} - ${escapeHtml(shift.endDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${hours(shift.totalMinutes)}</td>
      <td>${hours(shift.nightMinutes)}</td>
      <td>${hours(shift.holidayMinutes)}</td>
      <td>${hours(shift.overtimeMinutes)}</td>
      <td class="money">${escapeHtml(money(shift.estimatedAmount, locale))}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="${escapeHtml(locale.split('-')[0] || 'it')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Consuntivo turni - ${escapeHtml(monthLabel)}</title>
  <style>
    @page { size: A4 portrait; margin: 13mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 9pt; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.2mm solid #f47b16; padding-bottom: 4mm; }
    .brand { color: #c2520a; font-size: 8pt; font-weight: 800; letter-spacing: 1.2pt; text-transform: uppercase; }
    h1 { margin: 1.5mm 0 0; font-size: 24pt; line-height: 1; }
    .estimate { text-align: right; }
    .estimate strong { display: block; color: #9a3412; font-size: 22pt; }
    .estimate span { color: #64748b; font-size: 7pt; text-transform: uppercase; letter-spacing: .5pt; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; margin: 5mm 0; }
    .card { padding: 3mm; background: #fff7ed; border: .35mm solid #fed7aa; border-radius: 2mm; }
    .card b { display: block; color: #9a3412; font-size: 13pt; }
    .card span { color: #64748b; font-size: 6.5pt; font-weight: 700; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { padding: 2.4mm 1.8mm; background: #172033; color: #fff; font-size: 6.6pt; text-align: left; text-transform: uppercase; }
    td { padding: 2.2mm 1.8mm; border-bottom: .3mm solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .money { font-weight: 800; color: #9a3412; text-align: right; }
    .rules { margin-top: 4mm; padding: 3mm; background: #f8fafc; border-radius: 2mm; color: #475569; font-size: 7pt; }
    footer { margin-top: 4mm; color: #64748b; font-size: 7pt; line-height: 1.4; }
  </style>
</head>
<body>
  <header>
    <div><div class="brand">AeroStaff Pro</div><h1>Consuntivo ${escapeHtml(monthLabel)}</h1></div>
    <div class="estimate"><strong>${escapeHtml(money(summary.estimatedAmount, locale))}</strong><span>stima mensile</span></div>
  </header>
  <section class="cards">
    <div class="card"><b>${hours(summary.totalMinutes)}</b><span>Ore totali</span></div>
    <div class="card"><b>${hours(summary.nightMinutes)}</b><span>Notturne</span></div>
    <div class="card"><b>${hours(summary.holidayMinutes)}</b><span>Festive</span></div>
    <div class="card"><b>${hours(summary.overtimeMinutes)}</b><span>Straordinario</span></div>
  </section>
  <table>
    <thead><tr><th>Data</th><th>Orario</th><th>Ore</th><th>Notte</th><th>Festivo</th><th>Extra</th><th>Stima</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">Nessun turno di lavoro nel mese selezionato.</td></tr>'}</tbody>
  </table>
  <div class="rules">Paga base ${escapeHtml(money(rules.hourlyRate, locale))}/h - notte +${rules.nightBonusPercent}% - festivi +${rules.holidayBonusPercent}% - straordinario +${rules.overtimeBonusPercent}% oltre ${rules.dailyOvertimeThresholdHours} h/giorno.</div>
  <footer>Stima personale basata sui turni presenti nel calendario. Non sostituisce il cedolino, il contratto collettivo o il conteggio ufficiale del datore di lavoro.</footer>
</body>
</html>`;
}
