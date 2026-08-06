#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPrintableCalendarModule() {
  const absolutePath = path.join(root, 'src', 'utils', 'printableShiftCalendar.ts');
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require,
    Date,
    Intl,
    Object,
    String,
    Math,
  }, { filename: absolutePath });
  return module.exports;
}

function localDate(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

async function main() {
  const {
    A4_LANDSCAPE_PDF_SIZE,
    buildPrintableShiftCalendarHtml,
    printPrintableCalendarWithFallback,
    summarizePrintableShiftMonth,
  } = loadPrintableCalendarModule();

  const month = new Date(2026, 4, 1);
  const eventsByDate = {
    '2026-05-01': [{
      title: 'Lavoro',
      startDate: localDate(2026, 4, 1, 8, 0),
      endDate: localDate(2026, 4, 1, 16, 0),
    }],
    '2026-05-02': [{
      title: 'Lavoro',
      startDate: localDate(2026, 4, 2, 22, 0),
      endDate: localDate(2026, 4, 3, 6, 0),
    }],
    '2026-05-03': [{
      title: 'Riposo',
      startDate: localDate(2026, 4, 3, 0, 0),
      endDate: localDate(2026, 4, 3, 23, 59),
    }],
    '2026-06-01': [{
      title: 'Lavoro',
      startDate: localDate(2026, 5, 1, 9, 0),
      endDate: localDate(2026, 5, 1, 17, 0),
    }],
  };
  const summary = summarizePrintableShiftMonth(month, eventsByDate);
  assert(summary.totalMinutes === 960, 'summary should total both eight-hour May shifts');
  assert(summary.workShifts === 2, 'summary should count two May work shifts');
  assert(summary.restDays === 1, 'summary should count one May rest day');

  const html = buildPrintableShiftCalendarHtml({
    month,
    eventsByDate,
    locale: 'it-IT',
    monthNames: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
    weekDaysMondayFirst: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
    copy: {
      title: 'Calendario <turni>',
      work: 'Lavoro',
      rest: 'Riposo',
      noShift: 'Nessun turno',
      totalHours: 'Ore totali',
      workShifts: 'Turni lavoro',
      restDays: 'Giorni riposo',
      generatedBy: 'Generato da AeroStaff Pro',
    },
  });

  assert(html.includes('@page { size: A4 landscape;'), 'print CSS should force A4 landscape');
  assert(html.includes('Maggio 2026'), 'HTML should include the selected month label');
  assert(html.includes('16.0 h'), 'HTML should include the month total');
  assert(html.includes('22:00 - 06:00'), 'HTML should render an overnight shift');
  assert(html.includes('Calendario &lt;turni&gt;'), 'HTML should escape user-visible copy');
  assert(!html.includes('2026-06-01'), 'HTML should not include events outside the selected month');
  assert((html.match(/<div class="day(?: |")/g) || []).length === 42, 'calendar grid should always contain six full weeks');

  const mondayIndex = html.indexOf('>Lun</div>');
  const sundayIndex = html.indexOf('>Dom</div>');
  assert(mondayIndex >= 0 && sundayIndex > mondayIndex, 'weekday header should be Monday-first');

  assert(
    A4_LANDSCAPE_PDF_SIZE.width === 842 && A4_LANDSCAPE_PDF_SIZE.height === 595,
    'native PDF generation should use A4 landscape dimensions at 72 PPI',
  );

  const printCalls = [];
  const printed = await printPrintableCalendarWithFallback(html, {
    createPdf: async options => {
      printCalls.push(['create', options]);
      return { uri: 'file:///calendar.pdf' };
    },
    printPdf: async uri => { printCalls.push(['print', uri]); },
    canSharePdf: async () => false,
    sharePdf: async uri => { printCalls.push(['share', uri]); },
  });
  assert(printed.mode === 'printed', 'successful native printing should report printed mode');
  assert(printCalls[0][1].width === 842 && printCalls[0][1].height === 595, 'print action should create an A4 landscape PDF first');
  assert(printCalls[1][0] === 'print' && printCalls[1][1] === 'file:///calendar.pdf', 'print action should print the generated PDF URI');
  assert(!printCalls.some(call => call[0] === 'share'), 'successful native printing should not open sharing');

  const nativePrintError = new Error('Print spooler unavailable');
  const fallbackCalls = [];
  const shared = await printPrintableCalendarWithFallback(html, {
    createPdf: async () => ({ uri: 'file:///fallback.pdf' }),
    printPdf: async () => { throw nativePrintError; },
    canSharePdf: async () => true,
    sharePdf: async uri => { fallbackCalls.push(uri); },
  });
  assert(shared.mode === 'shared' && shared.printError === nativePrintError, 'failed native printing should report the PDF fallback');
  assert(fallbackCalls[0] === 'file:///fallback.pdf', 'fallback should share the PDF that failed to print');

  let unavailableError;
  try {
    await printPrintableCalendarWithFallback(html, {
      createPdf: async () => ({ uri: 'file:///unavailable.pdf' }),
      printPdf: async () => { throw nativePrintError; },
      canSharePdf: async () => false,
      sharePdf: async () => {},
    });
  } catch (error) {
    unavailableError = error;
  }
  assert(unavailableError === nativePrintError, 'the native print error should surface when PDF sharing is unavailable');

  console.log('Printable calendar tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
