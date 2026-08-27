#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  const dirname = path.dirname(absolutePath);
  const sandbox = {
    module,
    exports: module.exports,
    require: request => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      if (request.startsWith('.')) {
        const resolved = path.resolve(dirname, request);
        const relative = path.relative(root, resolved).replace(/\\/g, '/');
        const tsPath = fs.existsSync(`${resolved}.ts`) ? `${relative}.ts` : relative;
        return loadTsModule(tsPath, mocks);
      }
      return require(request);
    },
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Array,
    Math,
    JSON,
    RegExp,
    ...(mocks.__globals ?? {}),
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

const parser = loadTsModule('src/utils/pdfShiftParser.ts');

// ─── parseShiftCells: dates, names, work/rest shifts ─────────────────────────
function cell(text, x, y, page = 0) {
  return { text, x, y, page };
}

const cells = [
  // Day-name header row (must be ignored entirely)
  cell('Lunedì', 100, 30),
  cell('Martedì', 160, 30),
  cell('Mercoledì', 220, 30),
  // Date header row -> defines the 3 day columns
  cell('01/06/2026', 100, 50),
  cell('02/06/2026', 160, 50),
  cell('03/06/2026', 220, 50),
  // Employee 1: "Mario" / "Rossi" on two lines (<20px apart) -> "Mario Rossi"
  cell('Mario', 10, 80),
  cell('Rossi', 10, 85),
  cell('08.00-16.00', 100, 80), // dot separator
  cell('08:00-16:00', 160, 80), // colon separator
  cell('R', 220, 80),
  // Employee 2: "Anna" / "Bianchi"
  cell('Anna', 10, 120),
  cell('Bianchi', 10, 123),
  cell('R', 100, 120),
  cell('14.30-22.45', 160, 120),
  cell('F', 220, 120),
];

const parsed = parser.parseShiftCells(cells);
assert(JSON.stringify(parsed.dates) === JSON.stringify(['2026-06-01', '2026-06-02', '2026-06-03']), 'dates should be parsed in dd/mm/yyyy order and converted to ISO');

const mario = parsed.employees.find(e => e.name === 'Mario Rossi');
assert(mario, 'multi-line "Mario" + "Rossi" cells should be merged into employee "Mario Rossi"');
assert(mario.shifts[0].type === 'work' && mario.shifts[0].start === '08:00' && mario.shifts[0].end === '16:00', 'dot-separated shift "08.00-16.00" should parse as a work shift 08:00-16:00');
assert(mario.shifts[1].type === 'work' && mario.shifts[1].start === '08:00' && mario.shifts[1].end === '16:00', 'colon-separated shift "08:00-16:00" should parse as a work shift 08:00-16:00');
assert(mario.shifts[2].type === 'rest', '"R" cell should be parsed as a rest day');

const anna = parsed.employees.find(e => e.name === 'Anna Bianchi');
assert(anna, 'multi-line "Anna" + "Bianchi" cells should be merged into employee "Anna Bianchi"');
assert(anna.shifts[0].type === 'rest', '"R" cell should be parsed as a rest day for the first column too');
assert(anna.shifts[1].type === 'work' && anna.shifts[1].start === '14:30' && anna.shifts[1].end === '22:45', 'dot-separated shift "14.30-22.45" should parse as a work shift 14:30-22:45');
assert(anna.shifts[2].type === 'rest', '"F" cell should be parsed as a rest day');

// ─── parseShiftCells: mixed date formats from the August company export ─────
const augustCells = [
  cell('7/27/2026', 100, 50),
  cell('7/28/2026', 160, 50),
  cell('7/29/2026', 220, 50),
  cell('7/30/2026', 280, 50),
  cell('7/31/2026', 340, 50),
  cell('01/08/26', 400, 50),
  cell('02/08/26', 460, 50),
  cell('PAPUCCI CORRADO', 10, 80),
  cell('19.30-23.30', 400, 80),
  cell('17.30-21.30', 460, 80),
];
const augustParsed = parser.parseShiftCells(augustCells);
assert(
  JSON.stringify(augustParsed.dates) === JSON.stringify([
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
  ]),
  'mixed US-style and short Italian dates should be converted to ISO in column order',
);
const corrado = augustParsed.employees.find(e => e.name === 'PAPUCCI CORRADO');
assert(corrado, 'the August export should retain the employee name');
assert(corrado.shifts.length === 2, 'empty layout columns must not be converted into rest days');
assert(corrado.shifts[0].date === '2026-08-01' && corrado.shifts[0].type === 'work' && corrado.shifts[0].start === '19:30' && corrado.shifts[0].end === '23:30', '01/08/26 should retain its work shift');
assert(corrado.shifts[1].date === '2026-08-02' && corrado.shifts[1].type === 'work' && corrado.shifts[1].start === '17:30' && corrado.shifts[1].end === '21:30', '02/08/26 should retain its work shift');

const shortYearCells = [
  cell('03/08/26', 100, 50),
  cell('04/08/26', 160, 50),
  cell('PAPUCCI CORRADO', 10, 80),
  cell('R', 100, 80),
  cell('08,00-16,00', 160, 80),
];
const shortYearParsed = parser.parseShiftCells(shortYearCells);
assert(JSON.stringify(shortYearParsed.dates) === JSON.stringify(['2026-08-03', '2026-08-04']), 'dd/mm/yy dates should be accepted');
assert(shortYearParsed.employees[0].shifts[1].type === 'work' && shortYearParsed.employees[0].shifts[1].start === '08:00', 'comma-separated shifts should remain supported with short-year dates');

// ─── parseShiftCells: horizontally paginated weekday/weekend export ─────────
const splitPageCells = [
  cell('17/08/26', 100, 50, 0),
  cell('18/08/26', 160, 50, 0),
  cell('Mario Rossi', 10, 80, 0),
  cell('08.00-16.00', 100, 80, 0),
  cell('R', 160, 80, 0),
  cell('PAPUCCI', 10, 80, 1),
  cell('CORRADO', 10, 88, 1),
  cell('18.00-22.00', 100, 80, 1),
  cell('R', 160, 80, 1),
  cell('22/08/26', 100, 50, 3),
  cell('23/08/26', 160, 50, 3),
  cell('09.00-17.00', 100, 80, 3),
  cell('R', 160, 80, 3),
  cell('19.30-23.30', 100, 80, 4),
  cell('17.30-21.30', 160, 80, 4),
];
const splitPageParsed = parser.parseShiftCells(splitPageCells);
assert(
  JSON.stringify(splitPageParsed.dates) === JSON.stringify(['2026-08-17', '2026-08-18', '2026-08-22', '2026-08-23']),
  'horizontal page sections should keep weekday and weekend dates in section order',
);
const splitCorrado = splitPageParsed.employees.find(e => e.name === 'PAPUCCI CORRADO');
assert(splitCorrado, 'names from vertically continued pages should be retained');
assert(
  JSON.stringify(splitCorrado.shifts) === JSON.stringify([
    { date: '2026-08-17', type: 'work', start: '18:00', end: '22:00' },
    { date: '2026-08-18', type: 'rest' },
    { date: '2026-08-22', type: 'work', start: '19:30', end: '23:30' },
    { date: '2026-08-23', type: 'work', start: '17:30', end: '21:30' },
  ]),
  'weekend continuation cells should attach to the matching employee row',
);

// ─── parseShiftCells: empty input ────────────────────────────────────────────
const emptyParsed = parser.parseShiftCells([]);
assert(emptyParsed.dates.length === 0 && emptyParsed.employees.length === 0, 'parsing an empty cell list should return empty dates and employees');

// ─── parseShiftCells: unmatched shift text falls back to rest ───────────────
const garbledCells = [
  cell('01/06/2026', 100, 50),
  cell('Mario', 10, 80),
  cell('not-a-shift', 100, 80),
];
const garbledParsed = parser.parseShiftCells(garbledCells);
assert(garbledParsed.employees[0].shifts[0].type === 'rest', 'a shift cell that does not match the time pattern, "R" or "F" should default to rest');

// ─── mergeParsedSchedules: dedupe by normalized name, union dates, work>rest ─
const schedule1 = {
  dates: ['2026-06-01'],
  employees: [
    { name: 'Mario Rossi', shifts: [{ date: '2026-06-01', type: 'rest' }] },
  ],
};
const schedule2 = {
  dates: ['2026-06-01', '2026-06-02'],
  employees: [
    {
      name: 'mario   rossi',
      shifts: [
        { date: '2026-06-01', type: 'work', start: '08:00', end: '16:00' },
        { date: '2026-06-02', type: 'rest' },
      ],
    },
    {
      name: 'Anna Bianchi',
      shifts: [{ date: '2026-06-02', type: 'work', start: '14:30', end: '22:45' }],
    },
  ],
};

const merged = parser.mergeParsedSchedules([schedule1, schedule2]);
assert(JSON.stringify(merged.dates) === JSON.stringify(['2026-06-01', '2026-06-02']), 'merged schedules should union and sort all dates');
assert(merged.employees.length === 2, 'employees with the same normalized name across schedules should be merged into one');
assert(merged.employees[0].name === 'Anna Bianchi' && merged.employees[1].name === 'Mario Rossi', 'merged employees should be sorted alphabetically by name');

const mergedMario = merged.employees.find(e => e.name === 'Mario Rossi');
const mergedMarioJune1 = mergedMario.shifts.find(s => s.date === '2026-06-01');
assert(mergedMarioJune1.type === 'work' && mergedMarioJune1.start === '08:00', 'a later work shift should win over an earlier rest shift for the same date');

// ─── parseShiftCellFiles: combine multiple PDF extractions ───────────────────
const filesResult = parser.parseShiftCellFiles([{ cells }, { cells: garbledCells }]);
assert(filesResult.employees.find(e => e.name === 'Mario Rossi'), 'parseShiftCellFiles should merge employees found across multiple files');
assert(filesResult.dates.includes('2026-06-01') && filesResult.dates.includes('2026-06-03'), 'parseShiftCellFiles should union dates found across multiple files');

// ─── local/offline PDF.js runtime ───────────────────────────────────────────
const extractorHtml = parser.getPdfExtractorHtml('AA==', {
  library: 'export const getDocument = () => {}; // </script>',
  worker: 'self.onmessage = () => {};',
});
assert(!/https?:\/\//.test(extractorHtml), 'PDF extraction HTML must not load executable code or data from the network');
assert(extractorHtml.includes('Content-Security-Policy'), 'PDF extraction HTML should enforce a restrictive CSP');
assert(extractorHtml.includes("default-src 'none'"), 'PDF extraction CSP should deny all unspecified sources');
assert(extractorHtml.includes('URL.createObjectURL'), 'PDF.js library and worker should execute from verified bundled blobs');
assert(!extractorHtml.includes('// </script>'), 'embedded runtime source must escape closing script tags');
assert(extractorHtml.includes('await loadingTask.destroy()'), 'PDF extraction must dispose PDF.js 6 through PDFDocumentLoadingTask');
assert(!extractorHtml.includes('await pdf.destroy()'), 'PDF extraction must not call the removed PDFDocumentProxy.destroy API');

console.log('PDF shift parser test passed.');
