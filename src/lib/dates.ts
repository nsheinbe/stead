import { addDays, format, parseISO, startOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function prettyRange(checkIn: string, checkOut: string): string {
  const a = parseISO(checkIn);
  const b = parseISO(checkOut);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${format(a, "MMM d")}–${format(b, "d")}`;
  }
  return `${format(a, "MMM d")}–${format(b, "MMM d")}`;
}

export function prettyDay(iso: string): string {
  return format(parseISO(iso), "EEE, MMM d");
}

export function localClock(time: string, timezone: string, date: string): string {
  try {
    const [h, m] = time.split(":").map(Number);
    const hours = h ?? 16;
    const minutes = m ?? 0;
    const asUtc = `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`;
    return formatInTimeZone(asUtc, timezone, "h:mm a");
  } catch {
    return time;
  }
}

export function monthGrid(anchor: Date): { date: Date; inMonth: boolean }[] {
  const start = startOfMonth(anchor);
  const weekday = start.getDay();
  const first = addDays(start, -weekday);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(first, i);
    return { date, inMonth: date.getMonth() === anchor.getMonth() };
  });
}
