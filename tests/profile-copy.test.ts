/**
 * LIFE-02. What a profile and a review are allowed to claim.
 *
 * Two failures are easy to ship here and hard to notice. A member with no
 * completed stays has no average rating — rendering that as 0.00 invents a bad
 * review out of an empty record. And a review is not published when it is
 * written: the server publishes both sides together, later, so a button
 * labelled "Publish review" is a lie about what the click does.
 */
import { describe, expect, it } from "vitest";
import {
  formatPct,
  formatRating,
  statOrAbsent,
  verificationDetail,
  verificationLabel,
} from "../src/lib/passport";
import {
  ratingLabel,
  REVIEW_AFTER_SUBMIT,
  REVIEW_BLIND_RULE,
  REVIEW_PUBLISH_WINDOW_DAYS,
} from "../src/lib/reviews";

describe("statistics with nothing behind them", () => {
  it("says there isn't enough activity rather than showing a zero", () => {
    const rendered = statOrAbsent(null, (n) => `${formatRating(n)} out of 5`);
    expect(rendered).toBe("Not enough activity yet");
    expect(rendered).not.toContain("0");
  });

  it("renders a real rating exactly as the server gave it", () => {
    expect(statOrAbsent(4.5, (n) => `${formatRating(n)} out of 5`)).toBe("4.50 out of 5");
    expect(statOrAbsent(0, (n) => `${formatRating(n)} out of 5`)).toBe("0.00 out of 5");
  });

  it("keeps a genuine zero distinct from an absent value", () => {
    // A member who has been rated 0 is not the same as one with no ratings,
    // and the two must not collapse into the same string.
    expect(statOrAbsent(0, (n) => formatPct(n))).toBe("0%");
    expect(statOrAbsent(null, (n) => formatPct(n))).toBe("Not enough activity yet");
  });
});

describe("verification says what was checked", () => {
  it("names the actual check at each tier", () => {
    expect(verificationLabel(0)).toBe("Email verified");
    expect(verificationLabel(1)).toBe("Phone verified");
    expect(verificationLabel(2)).toBe("Government ID verified");
  });

  it("does not guess at a tier it has no record for", () => {
    expect(verificationLabel(-1)).toBe("Not verified");
    expect(verificationDetail(-1)).toMatch(/don't have a verification record/i);
    expect(verificationLabel(7)).toBe("Verification tier 7");
  });

  it("never describes a check as a guarantee about the member", () => {
    for (const tier of [0, 1, 2]) {
      const detail = verificationDetail(tier);
      expect(detail).not.toMatch(/safe|trusted|guarantee|vouch|approved/i);
    }
    // Tiers below an ID check say plainly that no document was checked.
    expect(verificationDetail(0)).toMatch(/No identity document has been checked/);
    expect(verificationDetail(1)).toMatch(/No identity document has been checked/);
  });
});

describe("review copy", () => {
  it("never calls a review permanent", () => {
    for (const copy of [REVIEW_BLIND_RULE, REVIEW_AFTER_SUBMIT]) {
      expect(copy).not.toMatch(/permanent|forever|can't be deleted|cannot be deleted/i);
    }
  });

  it("says submitting is not publishing", () => {
    // The server publishes both sides together; writing yours does not.
    expect(REVIEW_AFTER_SUBMIT).toMatch(/saved/i);
    expect(REVIEW_AFTER_SUBMIT).toMatch(/when the other side writes theirs/i);
    expect(REVIEW_AFTER_SUBMIT).not.toMatch(/published now|is now live|appears immediately/i);
  });

  it("quotes the window the database actually uses", () => {
    // `app.publish_due_reviews` in drizzle/0008_reviews.sql uses 14 days.
    expect(REVIEW_PUBLISH_WINDOW_DAYS).toBe(14);
    expect(REVIEW_BLIND_RULE).toContain("14 days");
    expect(REVIEW_AFTER_SUBMIT).toContain("14 days");
  });

  it("gives every rating a word, and nothing else one", () => {
    expect(ratingLabel(1)).toBe("Poor");
    expect(ratingLabel(5)).toBe("Excellent");
    expect(ratingLabel(0)).toBe("");
    expect(ratingLabel(6)).toBe("");
  });
});
