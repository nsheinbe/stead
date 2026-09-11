import { Button } from "../ui";

/**
 * Party size, bounded by what the home sleeps. The current value is announced
 * politely so a screen-reader user hears the change without losing the button.
 */
export function GuestStepper({
  guests,
  maxGuests,
  onChange,
}: {
  guests: number;
  maxGuests: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-divider px-4 py-3">
      <div>
        <p className="m-0 font-semibold">Guests</p>
        <p className="m-0 text-sm text-ink-secondary">This home sleeps {maxGuests}.</p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Fewer guests"
          disabled={guests <= 1}
          onClick={() => onChange(Math.max(1, guests - 1))}
        >
          −
        </Button>
        <p role="status" className="money m-0 w-8 text-center text-lg font-semibold">
          {guests}
          <span className="sr-only"> {guests === 1 ? "guest" : "guests"}</span>
        </p>
        <Button
          variant="secondary"
          size="sm"
          aria-label="More guests"
          disabled={guests >= maxGuests}
          onClick={() => onChange(Math.min(maxGuests, guests + 1))}
        >
          +
        </Button>
      </div>
    </div>
  );
}
