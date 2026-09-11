import { describe, expect, it } from "vitest";
import {
  clearAllDrafts,
  clearHostPrecreateDraft,
  deleteBookingDraft,
  DRAFT_TTL_MS,
  latestBookingDraftForListing,
  pruneExpiredDrafts,
  readBookingDraft,
  readHostPrecreateDraft,
  saveBookingDraft,
  saveHostPrecreateDraft,
} from "../src/lib/drafts";
import { memoryStorage, type StorageLike } from "../src/lib/storage";

const NOW = new Date("2026-09-11T12:00:00Z");
const LATER = new Date(NOW.getTime() + DRAFT_TTL_MS + 1000);

const selection = {
  listingId: "44444444-4444-4444-4444-444444444444",
  checkIn: "2026-11-01",
  checkOut: "2026-12-01",
  guests: 2,
  nightlyRateCents: 12_000,
  networkFeeBps: 200,
  ownerId: null,
};

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
    key: () => null,
    length: 0,
  };
}

describe("booking selection drafts", () => {
  it("round-trips a selection on the same device", () => {
    const storage = memoryStorage();
    const saved = saveBookingDraft(selection, storage, NOW);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const back = readBookingDraft(saved.draft.draftId, null, storage, NOW);
    expect(back.status).toBe("restored");
    if (back.status !== "restored") return;
    expect(back.draft).toMatchObject({ ...selection, schemaVersion: 1, kind: "booking_selection" });
    expect(back.draft.expiresAt).toBe(new Date(NOW.getTime() + DRAFT_TTL_MS).toISOString());
  });

  it("stores nothing but the selection", () => {
    const storage = memoryStorage();
    const saved = saveBookingDraft(selection, storage, NOW);
    if (!saved.ok) throw new Error("save failed");
    const raw = storage.getItem(`stead:draft:booking:${saved.draft.draftId}`) ?? "";
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      [
        "checkIn",
        "checkOut",
        "draftId",
        "expiresAt",
        "guests",
        "kind",
        "listingId",
        "networkFeeBps",
        "nightlyRateCents",
        "ownerId",
        "schemaVersion",
        "updatedAt",
      ].sort(),
    );
  });

  it("expires after the retention window and cleans up", () => {
    const storage = memoryStorage();
    const saved = saveBookingDraft(selection, storage, NOW);
    if (!saved.ok) throw new Error("save failed");
    expect(readBookingDraft(saved.draft.draftId, null, storage, LATER).status).toBe("expired");
    expect(storage.length).toBe(0);
  });

  it("reports missing, incompatible and unavailable distinctly", () => {
    const storage = memoryStorage();
    expect(readBookingDraft("nope", null, storage, NOW).status).toBe("missing");
    storage.setItem("stead:draft:booking:bad1", "{not json");
    expect(readBookingDraft("bad1", null, storage, NOW).status).toBe("incompatible");
    storage.setItem("stead:draft:booking:bad2", JSON.stringify({ schemaVersion: 2, kind: "booking_selection" }));
    expect(readBookingDraft("bad2", null, storage, NOW).status).toBe("incompatible");
    storage.setItem(
      "stead:draft:booking:bad3",
      JSON.stringify({ ...selection, schemaVersion: 1, kind: "booking_selection", draftId: "bad3", guests: 0, updatedAt: NOW.toISOString(), expiresAt: LATER.toISOString() }),
    );
    expect(readBookingDraft("bad3", null, storage, NOW).status).toBe("incompatible");
    expect(readBookingDraft("x", null, null, NOW).status).toBe("unavailable");
    expect(readBookingDraft("x", null, throwingStorage(), NOW).status).toBe("unavailable");
  });

  it("degrades to unavailable when storage refuses writes", () => {
    expect(saveBookingDraft(selection, null, NOW)).toEqual({ ok: false, reason: "unavailable" });
    expect(saveBookingDraft(selection, throwingStorage(), NOW)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never shows one member's draft to another, but a signed-out draft to whoever signs in", () => {
    const storage = memoryStorage();
    const mine = saveBookingDraft({ ...selection, ownerId: "member-a" }, storage, NOW);
    const anon = saveBookingDraft({ ...selection, ownerId: null }, storage, NOW);
    if (!mine.ok || !anon.ok) throw new Error("save failed");
    expect(readBookingDraft(mine.draft.draftId, "member-b", storage, NOW).status).toBe("missing");
    expect(storage.getItem(`stead:draft:booking:${mine.draft.draftId}`)).toBeNull();
    expect(readBookingDraft(anon.draft.draftId, "member-b", storage, NOW).status).toBe("restored");
    expect(readBookingDraft(anon.draft.draftId, null, storage, NOW).status).toBe("restored");
  });

  it("keeps distinct drafts per tab and finds the newest for a listing", () => {
    const storage = memoryStorage();
    const first = saveBookingDraft(selection, storage, NOW);
    const second = saveBookingDraft(
      { ...selection, checkIn: "2026-12-01", checkOut: "2027-01-01" },
      storage,
      new Date(NOW.getTime() + 1000),
    );
    if (!first.ok || !second.ok) throw new Error("save failed");
    expect(first.draft.draftId).not.toBe(second.draft.draftId);
    expect(latestBookingDraftForListing(selection.listingId, null, storage, NOW)?.draftId).toBe(second.draft.draftId);
    expect(latestBookingDraftForListing("other-listing", null, storage, NOW)).toBeNull();
    deleteBookingDraft(second.draft.draftId, storage);
    expect(latestBookingDraftForListing(selection.listingId, null, storage, NOW)?.draftId).toBe(first.draft.draftId);
  });

  it("updates in place when a draft id is supplied", () => {
    const storage = memoryStorage();
    const first = saveBookingDraft(selection, storage, NOW);
    if (!first.ok) throw new Error("save failed");
    const again = saveBookingDraft({ ...selection, draftId: first.draft.draftId, guests: 3 }, storage, NOW);
    expect(again.ok && again.draft.draftId).toBe(first.draft.draftId);
    expect(storage.length).toBe(1);
    const back = readBookingDraft(first.draft.draftId, null, storage, NOW);
    expect(back.status === "restored" && back.draft.guests).toBe(3);
  });
});

describe("homeowner pre-create draft", () => {
  it("keeps only the non-sensitive fields and one slot", () => {
    const storage = memoryStorage();
    const saved = saveHostPrecreateDraft(
      { title: "Canal room", type: "private_room", city: "Amsterdam", country: "nl", timezone: "Europe/Amsterdam", maxGuests: 2 },
      null,
      storage,
      NOW,
    );
    expect(saved.ok).toBe(true);
    const raw = storage.getItem("stead:draft:host_precreate") ?? "";
    expect(JSON.parse(raw)).not.toHaveProperty("fields.addressLine");
    const back = readHostPrecreateDraft(null, storage, NOW);
    expect(back.status).toBe("restored");
    if (back.status !== "restored") return;
    expect(back.draft.fields).toEqual({
      title: "Canal room",
      type: "private_room",
      city: "Amsterdam",
      country: "NL",
      timezone: "Europe/Amsterdam",
      maxGuests: 2,
    });
    const again = saveHostPrecreateDraft({ title: "Canal room II" }, null, storage, NOW);
    expect(again.ok && again.draft.draftId).toBe(back.draft.draftId);
    expect(storage.length).toBe(1);
  });

  it("drops unsupported and malformed fields on the way back in", () => {
    const storage = memoryStorage();
    storage.setItem(
      "stead:draft:host_precreate",
      JSON.stringify({
        schemaVersion: 1,
        kind: "host_precreate",
        draftId: "h1",
        ownerId: null,
        updatedAt: NOW.toISOString(),
        expiresAt: LATER.toISOString(),
        fields: { title: "x", type: "castle", maxGuests: 99, addressLine: "12 Secret St", description: "private" },
      }),
    );
    const back = readHostPrecreateDraft(null, storage, NOW);
    expect(back.status === "restored" && back.draft.fields).toEqual({ title: "x" });
  });

  it("is scoped to the member who saved it", () => {
    const storage = memoryStorage();
    saveHostPrecreateDraft({ title: "Mine" }, "member-a", storage, NOW);
    expect(readHostPrecreateDraft("member-b", storage, NOW).status).toBe("missing");
    expect(readHostPrecreateDraft("member-a", storage, NOW).status).toBe("missing");
    clearHostPrecreateDraft(storage);
    expect(readHostPrecreateDraft(null, storage, NOW).status).toBe("missing");
  });
});

describe("housekeeping", () => {
  it("clears every draft on sign-out and prunes expired ones", () => {
    const storage = memoryStorage();
    storage.setItem("unrelated", "keep");
    saveBookingDraft(selection, storage, NOW);
    saveBookingDraft(selection, storage, new Date(NOW.getTime() - DRAFT_TTL_MS - 5000));
    saveHostPrecreateDraft({ title: "x" }, null, storage, NOW);
    expect(pruneExpiredDrafts(storage, NOW)).toBe(1);
    expect(storage.length).toBe(3);
    clearAllDrafts(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});
