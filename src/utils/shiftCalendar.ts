import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

export type ShiftEventTitles = {
  work: string;
  rest: string;
};

export type RestEventTiming = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  allDay?: boolean;
};

export type ShiftReplacement = {
  date: string;
  type: 'work' | 'rest';
  startTime?: string;
  endTime?: string;
};

type ReplaceShiftForDateArgs = ShiftReplacement & {
  calendarId: string;
  titles?: ShiftEventTitles;
  restTiming?: RestEventTiming;
};

type ReplaceShiftsForRangeArgs = {
  calendarId: string;
  shifts: ShiftReplacement[];
  titles?: ShiftEventTitles;
  restTiming?: RestEventTiming;
};

export type ShiftImportRollback = {
  calendarId: string;
  dates: string[];
  previousShifts: ShiftReplacement[];
  importedShifts: ShiftReplacement[];
  importedAt: number;
};

export type SafeShiftImportResult = {
  createdCount: number;
  rollback: ShiftImportRollback;
};

const DEFAULT_TITLES: ShiftEventTitles = {
  work: 'Lavoro',
  rest: 'Riposo',
};

const DEFAULT_REST_TIMING: RestEventTiming = {
  startHour: 0,
  startMinute: 0,
  endHour: 23,
  endMinute: 59,
  allDay: false,
};

export const AEROSTAFF_SHIFT_EVENT_MARKER = 'AEROSTAFF_PRO_SHIFT_V1';

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

export function isOwnedShiftEvent(event: { title?: string | null; notes?: string | null }): boolean {
  if ((event.notes || '').trim() === AEROSTAFF_SHIFT_EVENT_MARKER) return true;

  // Releases before the ownership marker used only these exact titles. Keep
  // those legacy events editable, but never claim personal entries such as
  // "Lavoro da casa" or "Riposo medico" from the user's primary calendar.
  const title = (event.title || '').trim();
  return title === DEFAULT_TITLES.work || title === DEFAULT_TITLES.rest;
}

function toLocalDateKey(value: string | Date): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function createShiftEvent(
  calendarId: string,
  shift: ShiftReplacement,
  titles: ShiftEventTitles,
  restTiming: RestEventTiming,
): Promise<string | null> {
  const { year, month, day } = parseIsoDate(shift.date);

  if (shift.type === 'work') {
    if (!shift.startTime || !shift.endTime) return null;

    const startTime = parseTime(shift.startTime);
    const endTime = parseTime(shift.endTime);
    const startDate = new Date(year, month - 1, day, startTime.hour, startTime.minute, 0, 0);
    const endDate = new Date(year, month - 1, day, endTime.hour, endTime.minute, 0, 0);
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

    return Calendar.createEventAsync(calendarId, {
      title: titles.work,
      startDate,
      endDate,
      timeZone: 'Europe/Rome',
      notes: AEROSTAFF_SHIFT_EVENT_MARKER,
    });
  }

  const startDate = new Date(year, month - 1, day, restTiming.startHour, restTiming.startMinute, 0, 0);
  const endDate = new Date(year, month - 1, day, restTiming.endHour, restTiming.endMinute, 0, 0);
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

  return Calendar.createEventAsync(calendarId, {
    title: titles.rest,
    startDate,
    endDate,
    allDay: restTiming.allDay,
    timeZone: 'Europe/Rome',
    notes: AEROSTAFF_SHIFT_EVENT_MARKER,
  });
}

export async function getWritableCalendarId(): Promise<string | null> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const calendar =
    calendars.find(item => item.allowsModifications && item.isPrimary)
    || calendars.find(item => item.allowsModifications);

  if (calendar) return calendar.id;

  // Fallback: create a dedicated local calendar
  try {
    let source: Calendar.Source;
    if (Platform.OS === 'ios') {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      source = defaultCal.source;
    } else {
      source = { isLocalAccount: true, name: 'AeroStaff Pro', type: Calendar.SourceType.LOCAL, id: '' };
    }
    const id = await Calendar.createCalendarAsync({
      title: 'AeroStaff Turni',
      color: '#F47B16',
      entityType: Calendar.EntityTypes.EVENT,
      source,
      name: 'AeroStaff Pro',
      ownerAccount: 'AeroStaff Pro',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return id;
  } catch {
    return null;
  }
}

async function findShiftEventsInRange(
  calendarId: string,
  start: Date,
  end: Date,
  includedDates?: ReadonlySet<string>,
) {
  /* expo-calendar's Android query only returns events fully contained in the
     window (Instances.BEGIN >= start AND Instances.END <= end), so a night
     shift running past midnight - or an all-day rest stored in UTC - is
     invisible to an exact-day query and survives the replace, piling up
     duplicates on every edit. Query a day past the end, then keep only the
     shift events that actually START inside the requested range: a shift
     belongs to the day it starts on. */
  const queryEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  const events = await Calendar.getEventsAsync([calendarId], start, queryEnd);
  return events
    .filter(event => {
      if (!isOwnedShiftEvent(event)) return false;
      const startsAt = new Date(event.startDate).getTime();
      if (startsAt < start.getTime() || startsAt > end.getTime()) return false;
      return !includedDates || includedDates.has(toLocalDateKey(event.startDate));
    });
}

async function findShiftEventIdsInRange(
  calendarId: string,
  start: Date,
  end: Date,
  includedDates?: ReadonlySet<string>,
): Promise<string[]> {
  const events = await findShiftEventsInRange(calendarId, start, end, includedDates);
  return events.map(event => event.id);
}

async function deleteEventsByIds(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => Calendar.deleteEventAsync(id).catch(() => {})));
}

export async function deleteShiftEventsInRange(
  calendarId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const ids = await findShiftEventIdsInRange(calendarId, start, end);
  await deleteEventsByIds(ids);
  return ids.length;
}

export async function replaceShiftForDate({
  calendarId,
  date,
  type,
  startTime,
  endTime,
  titles = DEFAULT_TITLES,
  restTiming = DEFAULT_REST_TIMING,
}: ReplaceShiftForDateArgs): Promise<number> {
  if (type === 'work' && (!startTime || !endTime)) return 0;

  // Keep the existing shift until its replacement has been created successfully.
  return replaceShiftsForRange({
    calendarId,
    shifts: [{ date, type, startTime, endTime }],
    titles,
    restTiming,
  });
}

export async function replaceShiftsForRange({
  calendarId,
  shifts,
  titles = DEFAULT_TITLES,
  restTiming = DEFAULT_REST_TIMING,
}: ReplaceShiftsForRangeArgs): Promise<number> {
  if (shifts.length === 0) return 0;

  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = parseIsoDate(sorted[0].date);
  const lastDate = parseIsoDate(sorted[sorted.length - 1].date);
  const rangeStart = new Date(firstDate.year, firstDate.month - 1, firstDate.day, 0, 0, 0, 0);
  const rangeEnd = new Date(lastDate.year, lastDate.month - 1, lastDate.day, 23, 59, 59, 999);
  const includedDates = new Set(sorted.map(shift => shift.date));

  // Capture the existing shift events BEFORE creating anything, so we can
  // remove exactly those at the end. (Deleting by range instead would also
  // wipe the new events, which share the same 'Lavoro'/'Riposo' titles.)
  const oldEventIds = await findShiftEventIdsInRange(calendarId, rangeStart, rangeEnd, includedDates);

  // Create the new events FIRST. If any creation fails, roll back the events
  // we already created and leave the user's existing roster untouched: a
  // failed import the user can retry is far better than a half-wiped calendar.
  const createdIds: string[] = [];
  try {
    for (const shift of sorted) {
      const id = await createShiftEvent(calendarId, shift, titles, restTiming);
      if (id) createdIds.push(id);
    }
  } catch (e) {
    await deleteEventsByIds(createdIds);
    throw e;
  }

  // New events are all in place; now it is safe to remove the old ones.
  await deleteEventsByIds(oldEventIds);

  return createdIds.length;
}

function formatEventTime(value: string | Date): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export async function getShiftReplacementsForDates(
  calendarId: string,
  dates: string[],
): Promise<ShiftReplacement[]> {
  const uniqueDates = [...new Set(dates)].sort();
  if (uniqueDates.length === 0) return [];
  const first = parseIsoDate(uniqueDates[0]);
  const last = parseIsoDate(uniqueDates[uniqueDates.length - 1]);
  const rangeStart = new Date(first.year, first.month - 1, first.day, 0, 0, 0, 0);
  const rangeEnd = new Date(last.year, last.month - 1, last.day, 23, 59, 59, 999);
  const includedDates = new Set(uniqueDates);
  const events = await findShiftEventsInRange(calendarId, rangeStart, rangeEnd, includedDates);

  return events.map(event => {
    const date = toLocalDateKey(event.startDate);
    const type: 'work' | 'rest' = event.title.trim() === DEFAULT_TITLES.rest ? 'rest' : 'work';
    return type === 'rest'
      ? { date, type }
      : {
          date,
          type,
          startTime: formatEventTime(event.startDate),
          endTime: formatEventTime(event.endDate),
        };
  });
}

export async function replaceShiftsForRangeSafely(
  args: ReplaceShiftsForRangeArgs,
): Promise<SafeShiftImportResult> {
  const dates = [...new Set(args.shifts.map(shift => shift.date))].sort();
  const previousShifts = await getShiftReplacementsForDates(args.calendarId, dates);
  const createdCount = await replaceShiftsForRange(args);
  return {
    createdCount,
    rollback: {
      calendarId: args.calendarId,
      dates,
      previousShifts,
      importedShifts: args.shifts,
      importedAt: Date.now(),
    },
  };
}

export async function restoreShiftImport(
  rollback: ShiftImportRollback,
  calendarId = rollback.calendarId,
): Promise<number> {
  const uniqueDates = [...new Set(rollback.dates)].sort();
  if (uniqueDates.length === 0) return 0;
  const first = parseIsoDate(uniqueDates[0]);
  const last = parseIsoDate(uniqueDates[uniqueDates.length - 1]);
  const rangeStart = new Date(first.year, first.month - 1, first.day, 0, 0, 0, 0);
  const rangeEnd = new Date(last.year, last.month - 1, last.day, 23, 59, 59, 999);
  const includedDates = new Set(uniqueDates);
  if (Array.isArray(rollback.importedShifts)) {
    const currentShifts = await getShiftReplacementsForDates(calendarId, uniqueDates);
    const normalize = (shifts: ShiftReplacement[]) => shifts
      .map(shift => ({
        date: shift.date,
        type: shift.type,
        startTime: shift.startTime ?? '',
        endTime: shift.endTime ?? '',
      }))
      .sort((left, right) => `${left.date}-${left.type}`.localeCompare(`${right.date}-${right.type}`));
    if (JSON.stringify(normalize(currentShifts)) !== JSON.stringify(normalize(rollback.importedShifts))) {
      throw new Error('SHIFT_IMPORT_CHANGED_SINCE_IMPORT');
    }
  }
  const currentEventIds = await findShiftEventIdsInRange(calendarId, rangeStart, rangeEnd, includedDates);
  const createdIds: string[] = [];

  try {
    for (const shift of rollback.previousShifts) {
      const id = await createShiftEvent(calendarId, shift, DEFAULT_TITLES, DEFAULT_REST_TIMING);
      if (id) createdIds.push(id);
    }
  } catch (error) {
    await deleteEventsByIds(createdIds);
    throw error;
  }

  await deleteEventsByIds(currentEventIds);
  return createdIds.length;
}
