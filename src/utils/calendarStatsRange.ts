export type CalendarStatsRange = {
  key: string;
  startIso: string;
  endIso: string;
};

function toLocalIso(dateValue: Date): string {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

export function getCalendarStatsRange(selectedDayIso: string): CalendarStatsRange {
  const selected = fromIsoDate(selectedDayIso);
  const dayOfWeek = selected.getDay();
  const start = new Date(selected);
  start.setDate(selected.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const startIso = toLocalIso(start);
  const endIso = toLocalIso(end);
  return {
    key: `${startIso}_${endIso}`,
    startIso,
    endIso,
  };
}
