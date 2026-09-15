/**
 * HM-00. The copy module mirrors the design doc, and nothing banned slipped in.
 *
 * design/honesty-media/JOURNEYS-AND-COPY.md is the source of every honesty
 * string. This test parses its tables and holds src/lib/honesty.ts to them in
 * both directions, so a change in either place without the other is a red
 * test rather than a drift a reviewer has to spot.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUEST_BOOKINGS_CLOSED_MESSAGE } from "../server/lib/guestBookings";
import { BOOKINGS_CLOSED_COPY } from "../src/lib/guestBookings";
import {
  HM,
  hm,
  HONESTY_BADGE,
  HONESTY_BANNED_CONTROL_LABELS,
  HONESTY_BANNED_TERMS,
  HONESTY_POLICY_VERSION,
  HONESTY_RULE,
} from "../src/lib/honesty";

const DOC = readFileSync(
  path.resolve(__dirname, "../design/honesty-media/JOURNEYS-AND-COPY.md"),
  "utf8",
);

/** Typographic quotes in the doc, straight in the app. Compare on one form. */
function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
}

/** `| \`hm.x\` | copy |` rows, with italic doc-only notes dropped. */
function docStrings(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of DOC.split("\n")) {
    const match = /^\| `(hm\.[A-Za-z0-9.]+)` \| (.*?) \|(?: .*\|)?\s*$/.exec(line);
    if (!match) continue;
    const copy = match[2]!.replace(/\s*\*\([^)]*\)\*\s*$/, "");
    expect(out.has(match[1]!), `duplicate id in the doc: ${match[1]}`).toBe(false);
    out.set(match[1]!, normalize(copy));
  }
  return out;
}

describe("the copy module mirrors the design doc", () => {
  const doc = docStrings();

  it("finds the doc's tables", () => {
    expect(doc.size).toBeGreaterThan(200);
  });

  it("has every id the doc defines, with the same words", () => {
    for (const [id, copy] of doc) {
      expect(HM, `missing in src/lib/honesty.ts: ${id}`).toHaveProperty(id);
      expect(normalize(HM[id as keyof typeof HM]), id).toBe(copy);
    }
  });

  it("defines no id the doc does not", () => {
    for (const id of Object.keys(HM)) {
      expect(doc.has(id), `not in the design doc: ${id}`).toBe(true);
    }
  });

  it("keeps the pre-capture sheet's sentences in the readable §8 as well", () => {
    const prose = normalize(DOC);
    for (const id of Object.keys(HM).filter((k) => k.startsWith("hm.sheet.") && k.endsWith(".body"))) {
      expect(prose.includes(normalize(HM[id as keyof typeof HM])), id).toBe(true);
    }
    expect(prose.includes(normalize(HM["hm.sheet.acknowledge"]))).toBe(true);
  });

  it("keeps the two one-line mentions on existing routes in the doc", () => {
    expect(DOC).toContain("A geo-proven walkthrough of your home is required before guests can book.");
    expect(DOC).toContain("you’ll walk-scan the home from your phone. That comes after this setup.");
  });
});

describe("the badge and the rule are locked", () => {
  it("says exactly what HM-00 decided", () => {
    expect(HONESTY_BADGE.short).toBe("Geo-proven walkthrough");
    expect(HONESTY_BADGE.full).toBe(
      "Geo-proven walkthrough · Captured by the host · Stitched, not invented",
    );
    expect(HONESTY_RULE).toBe("stitch / stabilize / compress / cleanup only");
    expect(HONESTY_POLICY_VERSION).toMatch(/^\d+$/);
  });

  it("never describes the walk as live, certified or courtroom proof", () => {
    expect(HM["hm.badge.captured"]).toMatch(/^Captured \{date\}$/);
    expect(HM["hm.about.signal"]).toBe("Location proof is a strong signal, not a guarantee.");
  });
});

describe("nothing banned appears in any string", () => {
  const strings = Object.entries(HM);

  it("sweeps the house and honesty bans as whole words", () => {
    for (const term of HONESTY_BANNED_TERMS) {
      const pattern = new RegExp(`(^|[^a-z0-9])${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      for (const [id, copy] of strings) {
        expect(pattern.test(copy), `"${term}" in ${id}: ${copy}`).toBe(false);
      }
    }
  });

  it("has no control label from the forbidden list", () => {
    const forbidden = new Set(HONESTY_BANNED_CONTROL_LABELS.map((l) => l.toLowerCase()));
    for (const [id, copy] of strings) {
      expect(forbidden.has(copy.trim().toLowerCase()), `${id} is a forbidden control label`).toBe(false);
    }
  });

  it("never claims a walkthrough is a legal seal or a Trust Passport", () => {
    for (const [, copy] of strings) {
      expect(copy).not.toMatch(/legal seal|Trust Passport/);
    }
  });
});

describe("the Soft Dist kill-switch copy is untouched", () => {
  it("still says bookings are not open", () => {
    expect(BOOKINGS_CLOSED_COPY.title).toBe("Not open for bookings yet");
    expect(BOOKINGS_CLOSED_COPY.body).toBe(
      "Guest stays aren't live yet. You can still read the home and message the host.",
    );
    expect(GUEST_BOOKINGS_CLOSED_MESSAGE).toBe("Bookings aren't open yet.");
  });
});

describe("hm()", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    expect(hm("hm.loc.good", { accuracy: 8 })).toBe("Location: good (about 8 m)");
    expect(hm("hm.loc.good", {})).toBe("Location: good (about {accuracy} m)");
    expect(hm("hm.capture.maxLength", { maxMinutes: 20 })).toBe("Walks up to 20 minutes.");
  });
});
