import { addDays, addMonths, format, parseISO, startOfDay } from "date-fns";
import { useMemo, useState } from "react";
import { monthGrid, prettyDay } from "../../lib/dates";
import { MIN_STAY_NIGHTS } from "../../lib/money";
import { Button } from "../ui";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function isoToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Date selection for a stay.
 *
 * This is a date picker, not an availability feed: the catalog has no booked-day
 * data, so no day is ever painted "available". The only days it refuses are
 * ones that cannot make a legal stay — the past, and any checkout earlier than
 * the minimum from the chosen check-in.
 *
 * Every day button carries its full date as an accessible name, so the grid is
 * usable without seeing the column headers.
 */
export function StayCalendar({
  checkIn,
  checkOut,
  onPick,
  initialMonth,
}: {
  checkIn: string | null;
  checkOut: string | null;
  onPick: (iso: string) => void;
  initialMonth?: string | null;
}) {
  const [month, setMonth] = useState(() =>
    initialMonth ? startOfDay(parseISO(initialMonth)) : startOfDay(new Date()),
  );
  const cells = useMemo(() => monthGrid(month), [month]);
  const today = isoToday();
  const minCheckout = checkIn ? format(addDays(parseISO(checkIn), MIN_STAY_NIGHTS), "yyyy-MM-dd") : null;

  return (
    <div className="flex flex-col gap-3 rounded-surface bg-surface p-4">
      <div className="flex items-center justify-between">
        <Button
          variant="quiet"
          size="sm"
          aria-label="Previous month"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </Button>
        <p role="status" className="m-0 font-semibold">
          {format(month, "MMMM yyyy")}
        </p>
        <Button variant="quiet" size="sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </Button>
      </div>

      <div aria-hidden className="grid grid-cols-7 justify-items-center text-xs font-semibold text-ink-secondary">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day.slice(0, 1)}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 justify-items-center gap-y-1">
        {cells.map(({ date, inMonth }) => {
          const iso = format(date, "yyyy-MM-dd");
          const tooShort = Boolean(checkIn && !checkOut && minCheckout && iso > checkIn && iso < minCheckout);
          const past = iso < today;
          const disabled = !inMonth || past || tooShort;
          const isStart = iso === checkIn;
          const isEnd = iso === checkOut;
          const inRange = Boolean(checkIn && checkOut && iso > checkIn && iso < checkOut);
          const full = prettyDay(iso);

          return (
            <button
              key={`${iso}-${String(inMonth)}`}
              type="button"
              disabled={disabled}
              aria-current={isStart || isEnd ? "date" : undefined}
              onClick={() => onPick(iso)}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm ${
                isStart || isEnd
                  ? "bg-brand font-semibold text-white"
                  : inRange
                    ? "bg-surface-accent font-semibold text-brand"
                    : disabled
                      ? "text-ink-secondary/40"
                      : "font-medium hover:bg-surface-accent"
              }`}
            >
              <span aria-hidden>{date.getDate()}</span>
              <span className="sr-only">
                {full}
                {isStart ? ", selected as check-in" : isEnd ? ", selected as checkout" : ""}
                {tooShort ? `, too early for a ${MIN_STAY_NIGHTS}-night stay` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {checkIn && !checkOut && minCheckout ? (
        <p role="status" className="m-0 text-sm text-ink-secondary">
          Earliest checkout for a {MIN_STAY_NIGHTS}-night stay: {prettyDay(minCheckout)}.
        </p>
      ) : null}
    </div>
  );
}
