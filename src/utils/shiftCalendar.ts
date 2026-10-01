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

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

function isShiftEventTitle(title?: string | null) {
  return (title || '').includes('Lavoro') || (title || '').includes('Riposo');
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

async function findShiftEventIdsInRange(
  calendarId: string,
  start: Date,
  end: Date,
): Promise<string[]> {
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
      if (!isShiftEventTitle(event.title)) return false;
      const startsAt = new Date(event.startDate).getTime();
      return startsAt >= start.getTime() && startsAt <= end.getTime();
    })
    .map(event => event.id);
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
  const { year, month, day } = parseIsoDate(date);
  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

  await deleteShiftEventsInRange(calendarId, dayStart, dayEnd);

  const created = await createShiftEvent(
    calendarId,
    { date, type, startTime, endTime },
    titles,
    restTiming,
  );

  return created ? 1 : 0;
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

  // Capture the existing shift events BEFORE creating anything, so we can
  // remove exactly those at the end. (Deleting by range instead would also
  // wipe the new events, which share the same 'Lavoro'/'Riposo' titles.)
  const oldEventIds = await findShiftEventIdsInRange(calendarId, rangeStart, rangeEnd);

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
