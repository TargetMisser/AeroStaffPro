# Corrado Papucci Printable Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a verified one-page A4 landscape PDF containing Corrado Papucci's July 2026 shifts from the four user-provided source PDFs.

**Architecture:** Keep private shift data in a Git-ignored temporary Python script and produce the final artifact under `output/pdf/`. Use ReportLab for deterministic layout, pypdf for structural checks, and Poppler rendering for visual verification.

**Tech Stack:** Python 3.12, ReportLab, pypdf, pdfplumber, Poppler

---

### Task 1: Prepare and validate the private schedule data

**Files:**
- Create: `tmp/pdfs/corrado-calendar/generate_calendar.py`
- Read: `C:\Users\turni\Downloads\1-5 LUGLIO 2026.pdf`
- Read: `C:\Users\turni\Downloads\6-12 luglio2026.pdf`
- Read: `C:\Users\turni\Downloads\13-19 luglio2026.pdf`
- Read: `C:\Users\turni\Downloads\22-28LUGLIO2026.pdf`

- [ ] **Step 1: Encode the visually verified schedule in the temporary script**

Create a dictionary keyed by every day from 1 through 31. Use `None` only for days absent from the source PDFs, the string `RIPOSO` for explicit rest days, and normalized `HH:MM - HH:MM` strings for shifts.

- [ ] **Step 2: Add schedule integrity assertions**

```python
assert set(schedule) == set(range(1, 32))
assert sum(value == "RIPOSO" for value in schedule.values()) == 4
assert sum(value is None for value in schedule.values()) == 5
assert all(
    value is None or value == "RIPOSO" or " - " in value
    for value in schedule.values()
)
```

- [ ] **Step 3: Run the script through its data-validation phase**

Run:

```powershell
& 'C:\Users\turni\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  'tmp\pdfs\corrado-calendar\generate_calendar.py' --validate-only
```

Expected: exit code `0` and `Schedule validation passed: 31 days, 26 sourced entries`.

### Task 2: Generate the A4 landscape calendar

**Files:**
- Modify: `tmp/pdfs/corrado-calendar/generate_calendar.py`
- Create: `output/pdf/corrado-papucci-turni-luglio-2026.pdf`

- [ ] **Step 1: Implement the ReportLab layout**

Use `landscape(A4)`, a Monday-to-Sunday grid, five calendar rows, pastel fills for shifts and rest days, gray fills for unavailable dates, and normalized ASCII hyphens in time ranges.

- [ ] **Step 2: Generate the final PDF**

Run:

```powershell
& 'C:\Users\turni\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  'tmp\pdfs\corrado-calendar\generate_calendar.py'
```

Expected: exit code `0` and creation of `output/pdf/corrado-papucci-turni-luglio-2026.pdf`.

- [ ] **Step 3: Check PDF structure and text**

Run a pypdf check asserting one page, landscape orientation, the expected title, four `RIPOSO` labels, and five `Orario non disponibile` labels.

Expected: `PDF structure validation passed`.

### Task 3: Render and visually verify the result

**Files:**
- Read: `output/pdf/corrado-papucci-turni-luglio-2026.pdf`
- Create: `tmp/pdfs/corrado-calendar/rendered/calendar-1.png`

- [ ] **Step 1: Render the final PDF at 180 DPI**

Run:

```powershell
& 'C:\Users\turni\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe' `
  -png -r 180 `
  'output\pdf\corrado-papucci-turni-luglio-2026.pdf' `
  'tmp\pdfs\corrado-calendar\rendered\calendar'
```

Expected: a single PNG rendering.

- [ ] **Step 2: Inspect the rendered page**

Confirm that the title, weekday headers, day numbers, shifts, rest labels, unavailable labels, footer, borders, and margins are readable with no clipping or overlap.

- [ ] **Step 3: Recompare all 26 sourced entries**

Compare each populated or rest cell against the corresponding employee row in the four source PDFs. Correct any discrepancy, regenerate, and repeat structural and visual checks.

