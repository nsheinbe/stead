import { BOOKINGS_CLOSED_COPY } from "../lib/guestBookings";
import { StatusMessage } from "./ui";

/** Soft Dist panel: no Book / Reserve / Payment Element while the gate is off. */
export function BookingsClosed() {
  return (
    <StatusMessage tone="info" title={BOOKINGS_CLOSED_COPY.title} live={false} testId="bookings-closed">
      <p>{BOOKINGS_CLOSED_COPY.body}</p>
    </StatusMessage>
  );
}
