import { useState } from "react";
import { HM } from "../../lib/honesty";
import { Button, Checkbox, Dialog, StatusMessage } from "../ui";

/**
 * The pre-capture sheet (HM-D00). Every sentence is the locked disclosure
 * from design/honesty-media/JOURNEYS-AND-COPY.md §8.1, and the host cannot
 * start a walk without ticking that they read it. Mount with a fresh `key`
 * each time it opens so the acknowledgment never carries over.
 */
export function HonestySheet({
  open,
  onClose,
  onStart,
  starting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Dialog open={open} onClose={onClose} title={HM["hm.sheet.title"]} size="md" closeLabel={HM["hm.sheet.notNow"]}>
      <div className="flex flex-col gap-5 text-base">
        <section aria-labelledby="sheet-record">
          <h3 id="sheet-record" className="m-0 text-base font-semibold">
            {HM["hm.sheet.record.heading"]}
          </h3>
          <ul className="mb-0 mt-2 list-disc pl-5 text-ink-secondary">
            <li>{HM["hm.sheet.record.video"]}</li>
            <li>{HM["hm.sheet.record.location"]}</li>
          </ul>
        </section>
        <section aria-labelledby="sheet-why">
          <h3 id="sheet-why" className="m-0 text-base font-semibold">
            {HM["hm.sheet.why.heading"]}
          </h3>
          <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.sheet.why.body"]}</p>
        </section>
        <section aria-labelledby="sheet-video">
          <h3 id="sheet-video" className="m-0 text-base font-semibold">
            {HM["hm.sheet.video.heading"]}
          </h3>
          <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.sheet.video.body"]}</p>
        </section>
        <section aria-labelledby="sheet-private">
          <h3 id="sheet-private" className="m-0 text-base font-semibold">
            {HM["hm.sheet.private.heading"]}
          </h3>
          <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.sheet.private.body"]}</p>
        </section>
        <section aria-labelledby="sheet-bookings">
          <h3 id="sheet-bookings" className="m-0 text-base font-semibold">
            {HM["hm.sheet.bookings.heading"]}
          </h3>
          <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.sheet.bookings.body"]}</p>
        </section>
        <section aria-labelledby="sheet-tips">
          <h3 id="sheet-tips" className="m-0 text-base font-semibold">
            {HM["hm.sheet.tips.heading"]}
          </h3>
          <p className="mb-0 mt-2 text-ink-secondary">{HM["hm.sheet.tips.body"]}</p>
        </section>

        <Checkbox
          id="honesty-acknowledge"
          label={HM["hm.sheet.acknowledge"]}
          hint={acknowledged ? undefined : HM["hm.sheet.acknowledge.hint"]}
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />

        {error ? <StatusMessage tone="danger" title={error} /> : null}

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={!acknowledged}
            busy={starting}
            busyLabel={HM["hm.sheet.starting"]}
            onClick={onStart}
          >
            {HM["hm.sheet.start"]}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {HM["hm.sheet.notNow"]}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
