/**
 * Parses shift-schedule PDFs (base64) inside a WebView using pdf.js,
 * returns structured data: dates[], employees[{name, shifts[]}].
 *
 * The HTML/JS is injected into a hidden WebView by the caller.
 */

export type ParsedShift = { date: string; type: 'work' | 'rest'; start?: string; end?: string };
export type ParsedEmployee = { name: string; shifts: ParsedShift[] };
export type ParsedSchedule = { dates: string[]; employees: ParsedEmployee[] };

export type PdfTextCell = { text: string; x: number; y: number; page: number };
export type PdfExtractedFile = { cells: PdfTextCell[] };

type DatedPdfTextCell = PdfTextCell & { date: string };
type ColumnLayout = {
  dates: string[];
  ranges: { min: number; max: number }[];
  nameThreshold: number;
};

const DAY_HEADER_PATTERN = /^(luned|marted|mercoled|gioved|venerd|sabato|domenica)/i;
const SHIFT_CELL_PATTERN = /^\d{1,2}[,.:]\d{2}-\d{1,2}[,.:]\d{2,3}$/;

function parsePdfDate(text: string): string | null {
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);

  let day = first;
  let month = second;

  // The company exports use both Italian dates (01/08/26) and Excel's
  // unpadded US dates (7/27/2026). A value above 12 is definitive; for
  // otherwise ambiguous four-digit dates, the unpadded first component is
  // the format emitted by the US-style export.
  if (second > 12 || (first <= 12 && second <= 12 && match[3].length === 4 && match[1].length === 1)) {
    day = second;
    month = first;
  }

  if (day < 1 || month < 1 || month > 12) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildColumnLayout(dateCells: DatedPdfTextCell[]): ColumnLayout {
  const sorted = [...dateCells].sort((a, b) => a.x - b.x);
  const centers = sorted.map(cell => cell.x);
  const ranges = centers.map((center, index) => {
    const previous = index > 0 ? centers[index - 1] : center - 80;
    const next = index < centers.length - 1 ? centers[index + 1] : center + 80;
    return { min: (previous + center) / 2, max: (center + next) / 2 };
  });
  return {
    dates: sorted.map(cell => cell.date),
    ranges,
    nameThreshold: ranges[0].min,
  };
}

function findColumnIndex(x: number, ranges: ColumnLayout['ranges']): number {
  return ranges.findIndex(range => x >= range.min && x < range.max);
}

function parseShiftValue(text: string, date: string): ParsedShift {
  if (text.toUpperCase() === 'R' || text.toUpperCase() === 'F') return { date, type: 'rest' };
  const match = text.match(/^(\d{1,2})[,.:.](\d{2})-(\d{1,2})[,.:.](\d{2})/);
  if (!match) return { date, type: 'rest' };
  return {
    date,
    type: 'work',
    start: `${match[1].padStart(2, '0')}:${match[2]}`,
    end: `${match[3].padStart(2, '0')}:${match[4]}`,
  };
}

function parseHorizontallySplitSchedule(
  cells: PdfTextCell[],
  datedCells: DatedPdfTextCell[],
  headerPages: number[],
): ParsedSchedule {
  const nonEmptyPages = Array.from(new Set(cells.map(cell => cell.page))).sort((a, b) => a - b);
  const sections = headerPages.map((headerPage, index) => {
    const nextHeaderPage = headerPages[index + 1] ?? Number.POSITIVE_INFINITY;
    const pages = nonEmptyPages.filter(page => page >= headerPage && page < nextHeaderPage);
    const layout = buildColumnLayout(datedCells.filter(cell => cell.page === headerPage));
    return { pages, layout };
  });
  const primary = sections[0];
  const employees: { name: string; y: number; pageOffset: number }[] = [];

  primary.pages.forEach((page, pageOffset) => {
    const nameOnly = cells
      .filter(cell => (
        cell.page === page
        && cell.x < primary.layout.nameThreshold
        && parsePdfDate(cell.text) === null
        && !DAY_HEADER_PATTERN.test(cell.text)
        && !SHIFT_CELL_PATTERN.test(cell.text)
        && cell.text !== 'R'
        && cell.text !== 'F'
      ))
      .sort((a, b) => a.y - b.y);

    let index = 0;
    while (index < nameOnly.length) {
      const base = nameOnly[index];
      let name = base.text;
      let next = index + 1;
      while (next < nameOnly.length && nameOnly[next].y - base.y < 20) {
        name += ` ${nameOnly[next].text}`;
        next++;
      }
      employees.push({ name: name.trim(), y: base.y, pageOffset });
      index = next;
    }
  });

  const result = employees.map(employee => {
    const shifts = sections.flatMap(section => {
      const targetPage = section.pages[employee.pageOffset];
      if (targetPage === undefined) return [];
      const nearby = cells.filter(cell => (
        cell.page === targetPage
        && cell.x >= section.layout.nameThreshold
        && parsePdfDate(cell.text) === null
        && !DAY_HEADER_PATTERN.test(cell.text)
        && Math.abs(cell.y - employee.y) < 20
      ));
      return section.layout.dates.flatMap((date, dateIndex): ParsedShift[] => {
        const cell = nearby.find(candidate => findColumnIndex(candidate.x, section.layout.ranges) === dateIndex);
        return cell ? [parseShiftValue(cell.text, date)] : [];
      });
    });
    return { name: employee.name, shifts };
  });

  return {
    dates: sections.flatMap(section => section.layout.dates),
    employees: result,
  };
}

export function parseShiftCells(cells: PdfTextCell[]): ParsedSchedule {
  // 1. Find dates and build dynamic column ranges. Current company exports
  // may mix dd/mm/yy, dd/mm/yyyy and unpadded mm/dd/yyyy in the same sheet.
  const dateCells = cells
    .map(c => ({ ...c, date: parsePdfDate(c.text) }))
    .filter((c): c is PdfTextCell & { date: string } => c.date !== null)
    .sort((a, b) => a.x - b.x);
  const headerPages = Array.from(new Set(dateCells.map(cell => cell.page))).sort((a, b) => a - b);
  if (headerPages.length > 1) {
    return parseHorizontallySplitSchedule(cells, dateCells, headerPages);
  }
  const dates = dateCells.map(c => c.date);

  if (dates.length === 0) return { dates: [], employees: [] };

  // Build column ranges dynamically from date cell positions
  const colCenters = dateCells.map(c => c.x);
  const colRanges: { min: number; max: number }[] = colCenters.map((cx, i) => {
    const prev = i > 0 ? colCenters[i - 1] : cx - 80;
    const next = i < colCenters.length - 1 ? colCenters[i + 1] : cx + 80;
    return {
      min: (prev + cx) / 2,
      max: (cx + next) / 2,
    };
  });

  function colIndex(x: number): number {
    for (let i = 0; i < colRanges.length; i++) {
      if (x >= colRanges[i].min && x < colRanges[i].max) return i;
    }
    return -1;
  }

  // 2. Separate name cells (x < first column min) and shift cells
  const nameThreshold = colRanges[0].min;
  const nameCells = cells.filter(c => c.x < nameThreshold && parsePdfDate(c.text) === null && !DAY_HEADER_PATTERN.test(c.text));
  const shiftCells = cells.filter(c => c.x >= nameThreshold && parsePdfDate(c.text) === null && !DAY_HEADER_PATTERN.test(c.text));

  // 3. Group name cells into employee names (multi-line names within 20px y)
  const nameOnly = nameCells.filter(c => !SHIFT_CELL_PATTERN.test(c.text) && c.text !== 'R' && c.text !== 'F');
  nameOnly.sort((a, b) => a.page - b.page || a.y - b.y);

  const employees: { name: string; y: number; page: number }[] = [];
  let i = 0;
  while (i < nameOnly.length) {
    let name = nameOnly[i].text;
    const baseY = nameOnly[i].y;
    const basePage = nameOnly[i].page;
    let j = i + 1;
    while (j < nameOnly.length && nameOnly[j].page === basePage && nameOnly[j].y - baseY < 20) {
      name += ' ' + nameOnly[j].text;
      j++;
    }
    employees.push({ name: name.trim(), y: baseY, page: basePage });
    i = j;
  }

  // 4. For each employee, find their shift values by matching nearby cells to columns
  const result: ParsedEmployee[] = employees.map(emp => {
    const nearby = shiftCells.filter(c => c.page === emp.page && Math.abs(c.y - emp.y) < 20);
    const shifts: ParsedShift[] = dates.flatMap((date, di): ParsedShift[] => {
      const cell = nearby.find(c => colIndex(c.x) === di);
      // A missing cell is not a rest day. Partial sheets (for example the
      // 1-2 August export) keep earlier dates as empty layout columns; turning
      // those blanks into rest events would overwrite previously saved shifts.
      if (!cell) return [];
      return [parseShiftValue(cell.text, date)];
    });
    return { name: emp.name, shifts };
  });

  return { dates, employees: result };
}

function normalizeEmployeeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function shiftPriority(shift: ParsedShift): number {
  return shift.type === 'work' && shift.start && shift.end ? 2 : 1;
}

export function mergeParsedSchedules(schedules: ParsedSchedule[]): ParsedSchedule {
  const dateSet = new Set<string>();
  const employeeMap = new Map<string, ParsedEmployee>();

  for (const schedule of schedules) {
    for (const date of schedule.dates) dateSet.add(date);

    for (const employee of schedule.employees) {
      const key = normalizeEmployeeName(employee.name);
      if (!key) continue;

      const merged = employeeMap.get(key) ?? { name: employee.name.trim(), shifts: [] };
      const shiftsByDate = new Map<string, ParsedShift>(merged.shifts.map(shift => [shift.date, shift]));

      for (const shift of employee.shifts) {
        dateSet.add(shift.date);
        const current = shiftsByDate.get(shift.date);
        if (!current || shiftPriority(shift) >= shiftPriority(current)) {
          shiftsByDate.set(shift.date, shift);
        }
      }

      merged.shifts = Array.from(shiftsByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
      employeeMap.set(key, merged);
    }
  }

  return {
    dates: Array.from(dateSet).sort(),
    employees: Array.from(employeeMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function parseShiftCellFiles(files: PdfExtractedFile[]): ParsedSchedule {
  return mergeParsedSchedules(files.map(file => parseShiftCells(file.cells)));
}

/** HTML to inject into a hidden WebView for PDF text extraction */
export function getPdfExtractorHtml(base64Data: string | string[]): string {
  const pdfInputs = JSON.stringify(Array.isArray(base64Data) ? base64Data : [base64Data]);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs" type="module"></script>
</head><body><script type="module">
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs';

const pdfInputs = ${pdfInputs};

async function extractPdf(base64Data, fileIndex) {
    const raw = atob(base64Data);
    const uint8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i);

    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const cells = [];

    for (let p = 0; p < pdf.numPages; p++) {
      const page = await pdf.getPage(p + 1);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const text = item.str.trim();
        if (!text) continue;
        cells.push({
          text,
          x: Math.round(item.transform[4] * 10) / 10,
          y: Math.round((page.view[3] - item.transform[5]) * 10) / 10,
          page: p,
          fileIndex
        });
      }
    }

    return cells;
}

async function extract() {
  try {
    const files = [];
    for (let i = 0; i < pdfInputs.length; i++) {
      files.push({ cells: await extractPdf(pdfInputs[i], i) });
    }

    const cells = [];
    for (const file of files) cells.push(...file.cells);
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, cells, files }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, error: e.message }));
  }
}
extract();
</script></body></html>`;
}
