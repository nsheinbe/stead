/**
 * MEAS-01. Conversion facts, asserted against Postgres.
 *
 * A conversion number is only worth having if it cannot be inflated. Two
 * things would ruin it: a member writing their own activation, and a retry
 * counting twice. Both are refused by the database rather than by application
 * code, and these probes are issued as raw SQL over the `app_user` connection
 * so it is Postgres saying no.
 *
 * The dedupe cases are the ones that matter in production. A replayed Stripe
 * event, a retried request and two concurrent bookings all reach the same
 * recorder, and a lifetime fact must survive all three as exactly one row.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  asMember,
  asOwner,
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
  rawAsMember,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The recorder runs as the owner, mirroring how server paths reach it. */
async function record(
  outcome: string,
  memberId: string,
  subjectId: string | null = null,
  extra: { intent?: string; source?: string } = {},
): Promise<boolean> {
  const rows = (await asOwner((db) =>
    db.execute(sql`
      SELECT app.record_conversion_fact(
        ${outcome}::public.conversion_outcome,
        ${memberId}::uuid,
        ${subjectId}::uuid,
        NULL,
        ${extra.intent ?? "unknown"},
        ${extra.source ?? "unknown"},
        'test-release'
      ) AS created
    `),
  )) as unknown as { created: boolean }[];
  return rows[0]?.created === true;
}

async function factCount(outcome: string, memberId: string): Promise<number> {
  const rows = (await asOwner((db) =>
    db.execute(sql`
      SELECT count(*)::int AS n FROM public.conversion_facts
       WHERE outcome = ${outcome}::public.conversion_outcome
         AND member_id = ${memberId}::uuid
    `),
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function aMember(label: string): Promise<string> {
  const memberId = id();
  await insertMember(memberId, `${label}-${memberId}@stead.example`, label);
  return memberId;
}

describeDb("a lifetime fact happens once", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("records the first activation and refuses the second", async () => {
    const member = await aMember("renter");

    expect(await record("renter_activated", member)).toBe(true);
    // A retry, a replayed webhook, a second request — all the same call.
    expect(await record("renter_activated", member)).toBe(false);
    expect(await record("renter_activated", member)).toBe(false);
    expect(await factCount("renter_activated", member)).toBe(1);
  });

  it("survives concurrent first bookings for one member as a single fact", async () => {
    const member = await aMember("concurrent");

    // The real race: two confirmations landing at once.
    const results = await Promise.all([
      record("renter_activated", member),
      record("renter_activated", member),
      record("renter_activated", member),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await factCount("renter_activated", member)).toBe(1);
  });

  it("keeps different outcomes for the same member apart", async () => {
    const member = await aMember("both");
    expect(await record("renter_activated", member)).toBe(true);
    expect(await record("homeowner_activated", member)).toBe(true);
    // Renting and hosting are things a member does; neither excludes the other.
    expect(await factCount("renter_activated", member)).toBe(1);
    expect(await factCount("homeowner_activated", member)).toBe(1);
  });

  it("counts a per-subject fact once per subject, not once per member", async () => {
    const host = await aMember("host");
    const listingA = id();
    const listingB = id();
    // Inserted active, so the publication trigger has already recorded both.
    await insertListing({ id: listingA, hostId: host });
    await insertListing({ id: listingB, hostId: host });

    expect(await factCount("listing_published", host)).toBe(2);
    // A second home is a second publication and must not be swallowed, but
    // re-recording either one is a no-op.
    expect(await record("listing_published", host, listingA)).toBe(false);
    expect(await record("listing_published", host, listingB)).toBe(false);
    expect(await factCount("listing_published", host)).toBe(2);
  });

  it("records a booking confirmation once however many times the webhook fires", async () => {
    const host = await aMember("bk-host");
    const guest = await aMember("bk-guest");
    const listingId = id();
    const bookingId = id();
    await insertListing({ id: listingId, hostId: host });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId: guest,
      checkIn: day(40),
      checkOut: day(70),
      status: "confirmed",
    });

    expect(await record("booking_confirmed", guest, bookingId)).toBe(true);
    // Stripe redelivers; the same result arrives under a different event.
    expect(await record("booking_confirmed", guest, bookingId)).toBe(false);
    expect(await factCount("booking_confirmed", guest)).toBe(1);
  });
});

describeDb("only the server writes a conversion fact", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("gives a member no way to insert one", async () => {
    const member = await aMember("forger");

    const attempt = await rawAsMember(
      member,
      (tx) => tx`
        INSERT INTO public.conversion_facts (outcome, member_id)
        VALUES ('renter_activated', ${member}::uuid)
        RETURNING id
      `,
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );

    expect(attempt).toBe("refused");
    expect(await factCount("renter_activated", member)).toBe(0);
  });

  it("gives a member no way to call the recorder directly", async () => {
    const member = await aMember("caller");

    const attempt = await rawAsMember(
      member,
      (tx) => tx`
        SELECT app.record_conversion_fact(
          'renter_activated'::public.conversion_outcome, ${member}::uuid
        ) AS created
      `,
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );

    expect(attempt).toBe("refused");
    expect(await factCount("renter_activated", member)).toBe(0);
  });

  it("gives a member no way to overwrite or delete their first activation", async () => {
    const member = await aMember("overwriter");
    await record("renter_activated", member);

    const updated = await rawAsMember(
      member,
      (tx) => tx`
        UPDATE public.conversion_facts SET occurred_at = now()
         WHERE member_id = ${member}::uuid RETURNING id
      `,
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );
    const deleted = await rawAsMember(
      member,
      (tx) => tx`DELETE FROM public.conversion_facts WHERE member_id = ${member}::uuid RETURNING id`,
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );

    expect(updated).toBe("refused");
    expect(deleted).toBe("refused");
    expect(await factCount("renter_activated", member)).toBe(1);
  });

  it("gives a member no way to plant a fact against someone else", async () => {
    const attacker = await aMember("attacker");
    const victim = await aMember("victim");

    const attempt = await rawAsMember(
      attacker,
      (tx) => tx`
        INSERT INTO public.conversion_facts (outcome, member_id)
        VALUES ('homeowner_activated', ${victim}::uuid)
        RETURNING id
      `,
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );

    expect(attempt).toBe("refused");
    expect(await factCount("homeowner_activated", victim)).toBe(0);
  });
});

describeDb("a member reads their own facts and nobody else's", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("shows a member their own row and hides everyone else's", async () => {
    const mine = await aMember("mine");
    const theirs = await aMember("theirs");
    await record("renter_activated", mine);
    await record("renter_activated", theirs);

    const seen = (await rawAsMember(
      mine,
      (tx) => tx`SELECT member_id FROM public.conversion_facts`,
    )) as { member_id: string }[];

    expect(seen).toHaveLength(1);
    expect(seen[0]?.member_id).toBe(mine);
  });

  it("shows an anonymous connection nothing at all", async () => {
    const member = await aMember("anon-probe");
    await record("renter_activated", member);

    const seen = (await rawAsMember(
      null,
      (tx) => tx`SELECT id FROM public.conversion_facts`,
    )) as { id: string }[];
    expect(seen).toHaveLength(0);
  });

  it("gives ops totals without giving ops the rows", async () => {
    const member = await aMember("counted");
    const ops = await aMember("ops");
    const regular = await aMember("regular");
    await asOwner((db) =>
      db.execute(sql`UPDATE public.profiles SET is_ops = true WHERE id = ${ops}::uuid`),
    );
    await record("renter_activated", member);

    const totals = (await rawAsMember(
      ops,
      (tx) => tx`SELECT outcome, total FROM app.conversion_totals()`,
    )) as { outcome: string; total: string }[];
    expect(totals.some((row) => row.outcome === "renter_activated")).toBe(true);

    // Aggregates, not rows: ops still cannot read another member's fact.
    const rows = (await rawAsMember(
      ops,
      (tx) => tx`SELECT id FROM public.conversion_facts`,
    )) as { id: string }[];
    expect(rows).toHaveLength(0);

    // And a member without the flag gets no totals.
    const asRegular = (await rawAsMember(
      regular,
      (tx) => tx`SELECT outcome FROM app.conversion_totals()`,
    )) as { outcome: string }[];
    expect(asRegular).toHaveLength(0);
  });
});

describeDb("labels and times stay honest", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("keeps an attribution label it does not recognise out of the row", async () => {
    const member = await aMember("labelled");
    await record("renter_activated", member, null, {
      intent: "'; DROP TABLE conversion_facts; --",
      source: "https://evil.example/?utm=everything",
    });

    const [row] = (await asOwner((db) =>
      db.execute(sql`
        SELECT signup_intent, source FROM public.conversion_facts
         WHERE member_id = ${member}::uuid
      `),
    )) as unknown as { signup_intent: string; source: string }[];

    // Attribution is never worth failing a booking over, so a bad label
    // becomes 'unknown' rather than raising — but it never lands as given.
    expect(row?.signup_intent).toBe("unknown");
    expect(row?.source).toBe("unknown");
  });

  it("accepts the labels that are on the allowlist", async () => {
    const member = await aMember("attributed");
    await record("homeowner_activated", member, null, {
      intent: "homeowner",
      source: "homeowner_hero",
    });

    const [row] = (await asOwner((db) =>
      db.execute(sql`
        SELECT signup_intent, source FROM public.conversion_facts
         WHERE member_id = ${member}::uuid
      `),
    )) as unknown as { signup_intent: string; source: string }[];
    expect(row?.signup_intent).toBe("homeowner");
    expect(row?.source).toBe("homeowner_hero");
  });

  it("refuses a row that claims an unknown original time without being reconciled", async () => {
    const member = await aMember("timeline");
    const attempt = await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.conversion_facts (outcome, member_id, unknown_original_time)
        VALUES ('renter_activated', ${member}::uuid, true)
      `),
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );
    // A fact either knows when it happened or says it was reconstructed.
    // Inventing an exact time is the one thing it may not do.
    expect(attempt).toBe("refused");
  });

  it("refuses an outcome outside the enum", async () => {
    const member = await aMember("enum");
    const attempt = await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.conversion_facts (outcome, member_id)
        VALUES ('became_rich', ${member}::uuid)
      `),
    ).then(
      () => "allowed" as const,
      () => "refused" as const,
    );
    expect(attempt).toBe("refused");
  });
});

describeDb("conversion facts do not leak into other surfaces", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("keeps the facts table out of a member's booking and listing reads", async () => {
    // Guards against a future join quietly exposing cross-member outcomes.
    const member = await asMember(null, async () => aMember("isolation"));
    await record("renter_activated", member);

    const columns = (await rawAsMember(
      member,
      (tx) => tx`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'conversion_facts'
      `,
    )) as { column_name: string }[];
    // Reading the catalog is fine; reading another member's rows is not.
    expect(columns.length).toBeGreaterThan(0);

    const others = (await rawAsMember(
      member,
      (tx) => tx`
        SELECT id FROM public.conversion_facts WHERE member_id <> ${member}::uuid
      `,
    )) as { id: string }[];
    expect(others).toHaveLength(0);
  });
});

describeDb("facts are written by the transition, not by the caller", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("records a publication when a draft first becomes active, and not again", async () => {
    const host = await aMember("publisher");
    const listingId = id();
    await insertListing({ id: listingId, hostId: host, status: "draft" });

    // A draft is not a publication.
    expect(await factCount("listing_published", host)).toBe(0);

    await asOwner((db) =>
      db.execute(sql`UPDATE public.listings SET status = 'active' WHERE id = ${listingId}::uuid`),
    );
    expect(await factCount("listing_published", host)).toBe(1);

    // Pausing and republishing is a state change, not a second first.
    await asOwner((db) =>
      db.execute(sql`UPDATE public.listings SET status = 'paused' WHERE id = ${listingId}::uuid`),
    );
    await asOwner((db) =>
      db.execute(sql`UPDATE public.listings SET status = 'active' WHERE id = ${listingId}::uuid`),
    );
    expect(await factCount("listing_published", host)).toBe(1);
  });

  it("records the confirmation and the activation when a booking is confirmed", async () => {
    const host = await aMember("trig-host");
    const guest = await aMember("trig-guest");
    const listingId = id();
    const bookingId = id();
    await insertListing({ id: listingId, hostId: host });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId: guest,
      checkIn: day(40),
      checkOut: day(70),
      status: "pending_payment",
    });

    // Pending is not confirmed.
    expect(await factCount("booking_confirmed", guest)).toBe(0);
    expect(await factCount("renter_activated", guest)).toBe(0);

    await asOwner((db) =>
      db.execute(sql`UPDATE public.bookings SET status = 'confirmed' WHERE id = ${bookingId}::uuid`),
    );

    expect(await factCount("booking_confirmed", guest)).toBe(1);
    expect(await factCount("renter_activated", guest)).toBe(1);
    // The host's first received booking is a separate lifetime fact.
    expect(await factCount("host_first_booking_confirmed", host)).toBe(1);
  });

  it("counts a renter's second booking without a second activation", async () => {
    const host = await aMember("second-host");
    const guest = await aMember("second-guest");
    const listingId = id();
    await insertListing({ id: listingId, hostId: host });

    for (const [i, offset] of [40, 200].entries()) {
      const bookingId = id();
      await insertBooking({
        id: bookingId,
        listingId,
        guestId: guest,
        checkIn: day(offset),
        checkOut: day(offset + 30),
        status: "pending_payment",
      });
      await asOwner((db) =>
        db.execute(sql`UPDATE public.bookings SET status = 'confirmed' WHERE id = ${bookingId}::uuid`),
      );
      expect(await factCount("booking_confirmed", guest)).toBe(i + 1);
      // Activation is a lifetime fact and does not move.
      expect(await factCount("renter_activated", guest)).toBe(1);
    }
  });

  it("activates a homeowner whichever order readiness arrives in", async () => {
    // Publish first, Connect second.
    const hostA = await aMember("ready-a");
    const listingA = id();
    await insertListing({ id: listingA, hostId: hostA });
    await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.listing_photos (listing_id, storage_path, sort_order)
        VALUES (${listingA}::uuid, 'https://example.test/a.jpg', 0)
      `),
    );
    // Active with a photo, but Stripe has not enabled anything yet.
    expect(await factCount("homeowner_activated", hostA)).toBe(0);

    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.profiles
           SET stripe_charges_enabled = true, stripe_payouts_enabled = true
         WHERE id = ${hostA}::uuid
      `),
    );
    expect(await factCount("homeowner_activated", hostA)).toBe(1);

    // Connect first, publish second.
    const hostB = await aMember("ready-b");
    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.profiles
           SET stripe_charges_enabled = true, stripe_payouts_enabled = true
         WHERE id = ${hostB}::uuid
      `),
    );
    expect(await factCount("homeowner_activated", hostB)).toBe(0);

    const listingB = id();
    await insertListing({ id: listingB, hostId: hostB, status: "draft" });
    await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.listing_photos (listing_id, storage_path, sort_order)
        VALUES (${listingB}::uuid, 'https://example.test/b.jpg', 0)
      `),
    );
    // Still a draft, so still not ready.
    expect(await factCount("homeowner_activated", hostB)).toBe(0);

    await asOwner((db) =>
      db.execute(sql`UPDATE public.listings SET status = 'active' WHERE id = ${listingB}::uuid`),
    );
    expect(await factCount("homeowner_activated", hostB)).toBe(1);
  });

  it("does not call a published home ready when it has no photo", async () => {
    // Readiness policy v1 requires a photo. This is a measurement definition,
    // not a publication rule: the home is published either way.
    const host = await aMember("photoless");
    const listingId = id();
    await asOwner((db) =>
      db.execute(sql`
        UPDATE public.profiles
           SET stripe_charges_enabled = true, stripe_payouts_enabled = true
         WHERE id = ${host}::uuid
      `),
    );
    await insertListing({ id: listingId, hostId: host });

    expect(await factCount("listing_published", host)).toBe(1);
    expect(await factCount("homeowner_activated", host)).toBe(0);

    await asOwner((db) =>
      db.execute(sql`
        INSERT INTO public.listing_photos (listing_id, storage_path, sort_order)
        VALUES (${listingId}::uuid, 'https://example.test/c.jpg', 0)
      `),
    );
    expect(await factCount("homeowner_activated", host)).toBe(1);
  });

  it("never lets measurement refuse the transition it observes", async () => {
    // The triggers swallow their own failures on purpose: a missing fact is
    // recoverable by reconciliation, a refused payment is not. Proving it
    // means making the recorder actually raise, then checking the money
    // transition still commits.
    const host = await aMember("failopen-host");
    const guest = await aMember("failopen-guest");
    const listingId = id();
    const bookingId = id();
    await insertListing({ id: listingId, hostId: host });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId: guest,
      checkIn: day(40),
      checkOut: day(70),
      status: "pending_payment",
    });

    const original = (await asOwner((db) =>
      db.execute(sql`
        SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND p.proname = 'record_conversion_fact'
      `),
    )) as unknown as { def: string }[];
    const definition = original[0]?.def;
    expect(definition).toBeTruthy();

    try {
      await asOwner((db) =>
        db.execute(sql`
          CREATE OR REPLACE FUNCTION app.record_conversion_fact(
            p_outcome public.conversion_outcome,
            p_member_id uuid,
            p_subject_id uuid DEFAULT NULL,
            p_occurred_at timestamptz DEFAULT NULL,
            p_signup_intent text DEFAULT 'unknown',
            p_source text DEFAULT 'unknown',
            p_release_id text DEFAULT NULL
          ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
          SET search_path = public, pg_temp
          AS $fail$ BEGIN RAISE EXCEPTION 'measurement is broken'; END; $fail$
        `),
      );

      const updated = await asOwner((db) =>
        db.execute(sql`
          UPDATE public.bookings SET status = 'confirmed'
           WHERE id = ${bookingId}::uuid RETURNING id
        `),
      ).then(
        () => "committed" as const,
        () => "aborted" as const,
      );
      expect(updated).toBe("committed");

      // And no fact was invented to paper over the failure.
      expect(await factCount("booking_confirmed", guest)).toBe(0);
    } finally {
      await asOwner((db) => db.execute(sql.raw(definition as string)));
    }

    // The recorder works again, so later tests are unaffected.
    expect(await record("renter_activated", guest)).toBe(true);
  });
});
