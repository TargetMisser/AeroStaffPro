#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTsModule(relativePath, mocks = {}) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: id => {
      if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
      return require(id);
    },
    Date,
    Intl,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    JSON,
    Set,
    Map,
    console,
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

function testImportPreview() {
  const { analyzeShiftImport, formatComparableShift } = loadTsModule('src/utils/shiftImportSafety.ts');
  const preview = analyzeShiftImport([
    { date: '2026-08-01', type: 'work', startTime: '08:00', endTime: '16:00' },
    { date: '2026-08-02', type: 'rest' },
    { date: '2026-08-03', type: 'work', startTime: '12:00', endTime: '20:00' },
  ], [
    { date: '2026-08-01', type: 'work', startTime: '8:00', endTime: '16:00' },
    { date: '2026-08-02', type: 'work', startTime: '06:00', endTime: '14:00' },
  ]);
  assert(preview.unchangedCount === 1, 'safe import should identify an unchanged shift');
  assert(preview.replaceCount === 1, 'safe import should identify a replaced shift');
  assert(preview.newCount === 1, 'safe import should identify a new shift');
  assert(formatComparableShift(preview.rows[1].existing) === '06:00 - 14:00', 'preview should format the previous shift');
}

function testShiftSharing() {
  const { buildShiftIcs, buildShiftShareText } = loadTsModule('src/utils/shiftSharing.ts');
  const options = {
    eventsByDate: {
      '2026-08-01': [{ title: 'Lavoro', startDate: new Date(2026, 7, 1, 22, 0), endDate: new Date(2026, 7, 2, 6, 0) }],
      '2026-08-02': [{ title: 'Riposo', startDate: new Date(2026, 7, 2), endDate: new Date(2026, 7, 2, 23, 59) }],
    },
    startIso: '2026-08-01',
    endIso: '2026-08-03',
    locale: 'it-IT',
    title: 'Turni test',
  };
  const text = buildShiftShareText(options);
  assert(text.includes('22:00 - 06:00') && text.includes('Riposo') && text.includes('Nessun turno'), 'text share should cover work, rest and empty days');
  const ics = buildShiftIcs(options);
  assert(ics.includes('BEGIN:VCALENDAR') && ics.includes('DTSTART;TZID=Europe/Rome:20260801T220000'), 'ICS should contain the overnight work shift');
  assert(ics.includes('DTSTART;VALUE=DATE:20260802') && ics.includes('DTEND;VALUE=DATE:20260803'), 'ICS should export rest as one all-day event');
}

function testCompensation() {
  const mod = loadTsModule('src/utils/shiftCompensation.ts');
  const month = new Date(2026, 0, 1);
  const rules = { hourlyRate: 10, nightBonusPercent: 25, holidayBonusPercent: 30, overtimeBonusPercent: 25, dailyOvertimeThresholdHours: 8 };
  const events = {
    '2026-01-01': [{ title: 'Lavoro', startDate: new Date(2026, 0, 1, 22, 0), endDate: new Date(2026, 0, 2, 6, 0) }],
    '2026-01-04': [{ title: 'Lavoro', startDate: new Date(2026, 0, 4, 8, 0), endDate: new Date(2026, 0, 4, 18, 0) }],
  };
  const summary = mod.summarizeCompensationMonth(month, events, rules);
  assert(summary.totalMinutes === 1080, 'compensation should total 18 hours');
  assert(summary.nightMinutes === 480, '22:00-06:00 should count as eight night hours');
  assert(summary.holidayMinutes === 720, 'holiday minutes should include Jan 1 and the Sunday shift');
  assert(summary.overtimeMinutes === 120, 'ten-hour shift should include two overtime hours');
  assert(Math.abs(summary.estimatedAmount - 241) < 0.001, `estimated compensation should include additive bonuses, got ${summary.estimatedAmount}`);
  const html = mod.buildCompensationReportHtml(month, summary, rules, 'it-IT', 'Gennaio 2026');
  assert(html.includes('@page { size: A4 portrait;') && html.includes('Consuntivo Gennaio 2026'), 'compensation PDF HTML should be A4 portrait and labeled');
  assert(html.includes('Stima personale') && html.includes('<table>'), 'compensation report should include disclaimer and detail table');
  const csv = mod.buildCompensationCsv(month, summary, rules, 'it-IT');
  assert(csv.startsWith('\uFEFFData;') && csv.includes('Stima totale;241.00'), 'CSV should be Excel-friendly and contain the total');
}

function testWidgetPreferences() {
  const mod = loadTsModule('src/utils/widgetPreferences.ts');
  const parsed = mod.parseWidgetPreferences('{"mode":"load","workloadWindowMinutes":120,"showDataAge":false}');
  assert(parsed.mode === 'load' && parsed.workloadWindowMinutes === 120 && parsed.showDataAge === false, 'widget preferences should parse valid settings');
  const invalid = mod.parseWidgetPreferences('{"mode":"wat","workloadWindowMinutes":10}');
  assert(invalid.mode === 'auto' && invalid.workloadWindowMinutes === 90, 'widget preferences should fall back safely');
  const selection = mod.selectWidgetFlights([
    { departureTs: 1000, isPinned: true, id: 'pin' },
    { departureTs: 1100, id: 'next' },
    { departureTs: 1200, id: 'third' },
  ], { mode: 'load', workloadWindowMinutes: 60, showDataAge: true }, 900);
  assert(selection.flights.length === 3 && selection.workloadLevel === 'busy', 'load mode should select imminent flights and rate the workload');
  const pinSelection = mod.selectWidgetFlights(selection.flights, { mode: 'pinned', workloadWindowMinutes: 90, showDataAge: true }, 900);
  assert(pinSelection.flights[0].id === 'pin' && pinSelection.flights.length === 1, 'pinned mode should show only the pinned flight');
  const futureSelection = mod.selectWidgetFlights([
    { departureTs: 10_000, id: 'future-1' },
    { departureTs: 10_900, id: 'future-2' },
  ], { mode: 'load', workloadWindowMinutes: 60, showDataAge: true }, 900);
  assert(futureSelection.workloadCount === 2, 'load mode should measure the first upcoming block for a future shift');
  assert(mod.getWidgetFreshness(Date.now() - 20 * 60 * 1000) === 'stale', 'old widget data should be labeled stale');
  assert(mod.getWidgetFreshness(Date.now(), Date.now(), true) === 'offline', 'failed refresh should be labeled offline');
}

function testHandover() {
  const mod = loadTsModule('src/utils/handover.ts');
  const entry = mod.createHandoverEntry({
    shiftDate: '2026-08-18',
    scope: 'flight',
    flightNumber: 'FR1234',
    direction: 'departure',
    note: 'Passeggero PRM da seguire',
    checklist: ['DCS aggiornato'],
  }, 1000);
  const parsed = mod.parseHandoverEntries(JSON.stringify([entry]));
  assert(parsed.length === 1 && parsed[0].flightNumber === 'FR1234', 'handover entries should survive local serialization');
  const summary = mod.buildHandoverSummary(parsed, '2026-08-18');
  assert(summary.includes('Volo FR1234 (partenza)') && summary.includes('DCS aggiornato'), 'handover summary should include scope, note and checklist');
}

function testFeatureWiring() {
  const calendarSource = fs.readFileSync(path.join(root, 'src', 'screens', 'CalendarScreen.tsx'), 'utf8');
  const reportSource = fs.readFileSync(path.join(root, 'src', 'screens', 'PrintableCalendarScreen.tsx'), 'utf8');
  const notepadSource = fs.readFileSync(path.join(root, 'src', 'screens', 'NotepadScreen.tsx'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(root, 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
  assert(calendarSource.includes('replaceShiftsForRangeSafely') && calendarSource.includes('undoLastImport'), 'calendar screen should wire safe import and undo');
  assert(calendarSource.includes('buildShiftIcs') && calendarSource.includes('Condividi turno'), 'calendar screen should wire quick text/ICS sharing');
  assert(reportSource.includes('buildCompensationReportHtml') && reportSource.includes('shareCompensationCsv'), 'shift report screen should wire PDF and CSV exports');
  assert(notepadSource.includes('HANDOVER_STORAGE_KEY') && notepadSource.includes('buildHandoverSummary'), 'notes screen should wire structured handover storage and sharing');
  assert(settingsSource.includes('WIDGET_PREFERENCES_KEY') && settingsSource.includes('WIDGET 2.0'), 'settings should expose Widget 2.0 preferences');
}

async function testImportRollback() {
  const events = new Map([
    ['old', { id: 'old', title: 'Lavoro', startDate: new Date(2026, 7, 10, 8, 0), endDate: new Date(2026, 7, 10, 16, 0), notes: 'AEROSTAFF_PRO_SHIFT_V1' }],
  ]);
  let created = 0;
  const calendarMock = {
    getEventsAsync: async (_ids, start, end) => [...events.values()].filter(event => event.startDate >= start && event.endDate <= end),
    createEventAsync: async (_calendarId, data) => {
      const id = `new-${++created}`;
      events.set(id, { id, ...data });
      return id;
    },
    deleteEventAsync: async id => { events.delete(id); },
  };
  const mod = loadTsModule('src/utils/shiftCalendar.ts', {
    'expo-calendar': calendarMock,
    'react-native': { Platform: { OS: 'android' } },
  });
  const result = await mod.replaceShiftsForRangeSafely({
    calendarId: 'cal',
    shifts: [{ date: '2026-08-10', type: 'work', startTime: '09:00', endTime: '17:00' }],
  });
  assert(result.rollback.previousShifts[0].startTime === '08:00', 'safe import should snapshot the previous shift');
  assert([...events.values()].some(event => new Date(event.startDate).getHours() === 9), 'safe import should install the new shift');
  await mod.restoreShiftImport(result.rollback);
  assert([...events.values()].length === 1 && [...events.values()][0].startDate.getHours() === 8, 'undo should restore the previous shift and remove the imported one');

  const second = await mod.replaceShiftsForRangeSafely({
    calendarId: 'cal',
    shifts: [{ date: '2026-08-10', type: 'work', startTime: '10:00', endTime: '18:00' }],
  });
  const importedEvent = [...events.values()][0];
  importedEvent.startDate = new Date(2026, 7, 10, 11, 0);
  let staleRollbackError;
  try {
    await mod.restoreShiftImport(second.rollback);
  } catch (error) {
    staleRollbackError = error;
  }
  assert(staleRollbackError?.message === 'SHIFT_IMPORT_CHANGED_SINCE_IMPORT', 'undo should refuse to overwrite shifts edited after the import');
}

async function main() {
  testImportPreview();
  testShiftSharing();
  testCompensation();
  testWidgetPreferences();
  testHandover();
  testFeatureWiring();
  await testImportRollback();
  console.log('Productivity feature tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
