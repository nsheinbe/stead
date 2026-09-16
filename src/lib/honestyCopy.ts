/**
 * Honesty media — the locked strings (HM-00).
 *
 * Every honesty-media surface imports its copy from here: the badge, the
 * guest and host disclosures, scan state labels, the location readout, the
 * refusal messages the API returns verbatim, and the one-line mentions on
 * existing pages. Tests import these too, so a string changes in one place
 * and a copy review is a diff of this file.
 *
 * Source of truth for the wording:
 *   design/honesty-media/JOURNEYS-AND-COPY.md §1
 *
 * Rules this file must keep (asserted in tests/honesty-copy.test.ts):
 *  - No banned verb or platform word (see HONESTY_VERBS.banned and
 *    PLATFORM_BANNED_WORDS). That includes "disabled for later" controls.
 *  - The Soft Dist kill-switch copy (src/lib/guestBookings.ts and
 *    server/lib/guestBookings.ts) is untouched and the scan refusal never
 *    reuses its words, so the two gates stay distinguishable.
 *  - "Captured {date}" is a listing-local date, never "live" or "today".
 *  - The badge is a status label, not a seal: no proof, GPS certainty or
 *    legal-record claims.
 *
 * This module is plain TypeScript with no React so the server can import it.
 */

/**
 * Bumped when a disclosure sentence changes meaning. HM-02 snapshots this
 * onto each scan row so a later copy change is visible as a version, not a
 * silent rewrite of what a host agreed to. Until that migration exists the
 * constant is the only home for the value.
 */
import type { ScanReason } from "./types";

export const HONESTY_POLICY_VERSION = 1 as const;

/** The badge. Text-led; the check glyph beside it is decorative. */
export const HONESTY_BADGE = {
  /** Listing cards, walk chrome on phone. */
  short: "Geo-proven walkthrough",
  /** Listing detail, walk chrome on desktop, the disclosure sheet. */
  full: "Geo-proven walkthrough · Captured by the host · Stitched, not invented",
  /** Host dashboard and editor only — never public. */
  ownerProcessing: "Honesty scan in progress",
  /** Host dashboard and editor only — never public. */
  ownerMissing: "No honesty scan yet",
} as const;

/**
 * Shown in full on listing detail (collapsed behind the title on phone) and
 * in the walk chrome's info sheet. Every sentence is load-bearing.
 */
export const HONESTY_GUEST_DISCLOSURE = {
  title: "About this walkthrough",
  paragraphs: [
    "The host filmed this walk on their phone, at this home. While they walked, their phone's location was checked against the home's location on Stead. Only the finished walkthrough is shown — never their route.",
    "The 3D view is stitched from what they filmed. We stabilise, crop and compress it. We never add rooms, furniture, windows or views that were not captured. If the footage was not enough, the host was asked to walk again.",
    "Location checks are a signal that the walk happened here. They are not proof against every trick, and they are not a legal record.",
  ],
} as const;

/** Captured-on and coverage lines. `date` is already formatted in the listing's time zone. */
export const HONESTY_CAPTURED = {
  capturedOn: (date: string) => `Captured ${date}`,
  hint: "Dates follow this home's time zone.",
  coverage: {
    whole_home: {
      label: "Whole home",
      body: "The walkthrough covers everything in the rental.",
    },
    rental_area: {
      label: "Rental area only",
      body: "The host left private rooms out. What you see is what you rent.",
    },
  },
} as const;

/** Nearby homes and outdoor imagery labels (HM-06 / HM-07). */
export const HONESTY_NEARBY = {
  heading: "Homes on Stead near here",
  explainer: "Every pin is a real home on Stead with a geo-proven walkthrough. Nothing on this map is generated.",
  empty: (city: string) => `No homes on Stead in ${city} yet.`,
  emptyBody: "The first homes here will come from people who list them.",
  imagery: {
    host: "Approach filmed by the host.",
    thirdParty: (provider: string) =>
      `Street imagery from ${provider}. Not captured by the host, and not part of the honesty scan.`,
    none: "No street imagery here yet. We do not draw what nobody filmed.",
  },
} as const;

/** The sheet a host dismisses with "Start the walk" before the camera opens. Shown every time. */
export const HONESTY_HOST_SHEET = {
  title: "Before you start the walk",
  sections: [
    {
      heading: "What we capture.",
      body: "Video from your phone's camera, and your phone's location, checked continuously while you walk.",
    },
    {
      heading: "Why location.",
      body: "To show guests this walk happened at this home. Guests never see your route — only the finished walkthrough.",
    },
    {
      heading: "What we do with the footage.",
      body: "We stitch, stabilise, crop and compress it. We never invent rooms, furniture or views. If the footage is not enough, we will ask you to walk again rather than make up what's missing.",
    },
    {
      heading: "Private rooms.",
      body: "After processing, you mark what is private. Those parts are cut before anyone else can see the walkthrough.",
    },
    {
      heading: "Bookings.",
      body: "Guests cannot book this home until a scan is verified. That is separate from payouts, and separate from Stead opening guest bookings.",
    },
  ],
  start: "Start the walk",
  dismiss: "Not now",
} as const;

/**
 * Host-facing scan states. One label and one next action per state; the
 * pill colour only reinforces the label. No state uses the danger tone —
 * a failed scan is not a claim or a dispute.
 */
export type ScanStateKey =
  | "not_started"
  | "needs_location"
  | "capturing"
  | "uploading"
  | "uploaded"
  | "reconstructing"
  | "needs_mask"
  | "verified"
  | "rejected"
  | "failed";

export type ScanStateTone = "neutral" | "warning" | "brand";

export const SCAN_STATE_COPY: Record<
  ScanStateKey,
  { label: string | ((date: string) => string); tone: ScanStateTone; action: string }
> = {
  not_started: { label: "Not started", tone: "neutral", action: "Scan this home" },
  needs_location: { label: "Needs the home's location", tone: "warning", action: "Confirm the home's location" },
  capturing: { label: "Capturing", tone: "neutral", action: "Continue the walk" },
  uploading: { label: "Uploading", tone: "neutral", action: "Finish uploading" },
  uploaded: { label: "Queued for processing", tone: "neutral", action: "Check progress" },
  reconstructing: { label: "Processing", tone: "neutral", action: "Check progress" },
  needs_mask: { label: "Needs private rooms marked", tone: "warning", action: "Mark private rooms" },
  verified: { label: (date: string) => `Verified ${date}`, tone: "brand", action: "View the walkthrough" },
  rejected: { label: "Couldn't confirm the location", tone: "warning", action: "Walk again" },
  failed: { label: "Processing didn't finish", tone: "warning", action: "See what happened" },
};

/**
 * Location readout during capture. Human units, no seal, no decimals.
 * `metres` is the reported accuracy radius; it is rounded to 5 m here so
 * the readout never chatters.
 */
export const LOCATION_READOUT = {
  good: (metres: number) => `Location: good (about ${roundTo5(metres)} m)`,
  rough: (metres: number) =>
    `Location: rough (about ${roundTo5(metres)} m). Step outside or near a window for a better fix.`,
  waiting: "Location: waiting for your phone",
  off: "Location: off. Allow location for this site to continue.",
} as const;

function roundTo5(metres: number): number {
  if (!Number.isFinite(metres) || metres < 0) return 0;
  return Math.round(metres / 5) * 5;
}

/**
 * Exact messages the API returns and the UI shows verbatim. These are the
 * one case where the browser may show server text. The scan refusals use
 * different words from the platform kill-switch on purpose.
 */
export const HONESTY_REFUSALS = {
  /** 409 from create-booking when the platform switch is on but the scan is not verified (HM-08). */
  bookingNotVerified: "This home isn't open for booking yet. Its honesty scan hasn't been verified.",
  /** 409 from publish when the scan is not verified (HM-08). */
  publishNotVerified: "This home needs a verified honesty scan before it can be published.",
  /** 409 from starting a scan before the front door is confirmed (HM-01). */
  coordinatesUnconfirmed: "Confirm where the home is before you scan it.",
  /** 409 from completing an upload with a missing part (HM-02). */
  uploadIncomplete: "Some of the walk didn't finish uploading. Finish uploading, then try again.",
  /** 400 when the uploaded location record cannot be read (HM-02). */
  attestationUnreadable: "The location record from your phone couldn't be read. Walk again.",
  /** 409 when an object is over the size cap at completion (HM-02). */
  uploadTooLarge: "That recording is bigger than we can process. Walk again and keep it shorter.",
  /** 409 when a walk is completed twice or after it was already judged (HM-02). */
  alreadySubmitted: "This walk was already submitted. Start a new walk to scan again.",
  /** 409 when a retry is asked for on a scan that is not `failed` (HM-03). */
  retryNotFailed: "This scan isn't waiting for a retry.",
  /** 409 from the mask page when the scan is not waiting to be marked (HM-04). */
  maskNotReady: "The scan isn't ready to mark yet.",
  /** 400 when the marks would leave a guest nothing to walk through (HM-04). */
  maskAllPrivate: "You've marked the whole walk private. Keep at least the rental area.",
  /** 400 when a private-room listing tries to confirm whole home (D11). */
  maskPrivateRoomWholeHome: "A private room listing always needs its private parts marked.",
  /** 409 from sending a scan with no answer on it yet (HM-04). */
  maskNothingMarked: "Mark private parts, or confirm the whole walk is the rental.",
  /** 409 when the attempt cap is spent (HM-03). */
  retryExhausted: (attempts: number) =>
    `We've tried ${attempts} times. Walk again, slower and with more overlap between rooms.`,
  /** 503 when object storage is not configured. */
  storageNotConfigured: "Scans aren't configured on this deployment.",
  /** 409 from starting a scan on a hidden demo listing. */
  demoListing: "Demo homes can't be scanned.",
  /** Browser-side, when WebGL is unavailable (HM-05). */
  webglUnavailable: "This walkthrough needs a newer browser. Here are stills from the host's walk.",
} as const;

/**
 * Reasons attached to a `rejected` or `failed` scan. The key is what the
 * scan row stores; the sentence is what the host reads on the status page.
 */
export const SCAN_REASON_COPY: Record<ScanReason, string> = {
  too_few_samples:
    "We didn't get enough accurate location readings during the walk. Start and finish outside so your phone can get a clear fix.",
  location_mismatch:
    "The location readings don't match where this home is on Stead. Check the home's location in the editor, then walk again.",
  walk_too_short:
    "The walk was too short to build from. Film every room you rent, slowly, then finish outside the front door.",
  walk_too_long:
    "That walk is longer than we can process. Walk again and keep it shorter.",
  reconstruction_failed:
    "We couldn't build a walkthrough from this footage. This usually means the walk was too fast, too dark, or didn't overlap enough between rooms.",
};

/** @deprecated alias kept for HM-00 callers; prefer ScanReason from ./types. */
export type ScanReasonKey = ScanReason;

/**
 * The status page's sentence per scan state (HM-D04). "This can take a
 * while — often hours" is deliberate: the worker reports no percentage and
 * the page never invents an ETA.
 */
export const SCAN_STATUS_COPY = {
  none: "This home hasn't been scanned yet.",
  capturing: "The walk hasn't finished uploading.",
  uploaded: "Queued for processing. This can take a while — often hours. We'll email you when it's done.",
  reconstructing:
    "Processing your walk into a 3D walkthrough. This can take a while — often hours. We'll email you when it's done.",
  needs_mask: "Your walkthrough is ready for you to check. Mark anything private before it's verified.",
  verified: (date: string) => `Verified ${date}. Guests will see this walkthrough once the home is published.`,
  rejected: "We couldn't confirm the location.",
  failed: "Processing didn't finish.",
  checkAgainStill: "Still processing.",
  checkAgainReady: "Ready for you to check.",
  stillsCaption: "Frames from your walk. Nothing here is generated.",
  stillsNone: "The worker didn't save any frames from this walk.",
  /** The quiet "What happens next" surface (HM-D04 §3). */
  whatNext:
    "Once the walkthrough is built, you mark anything private and those parts are cut before anyone else sees it. Only then can it be verified.",
} as const;

/**
 * The mask page (HM-D05). The promise this copy makes is narrow and exact:
 * a marked part is *cut*, never blurred, tidied or filled in. The worker
 * drops those frames before it builds anything, so a private room is not in
 * the walkthrough rather than hidden inside it.
 */
export const MASK_COPY = {
  intro:
    "Guests will walk through what you keep. Mark anything private — a bedroom, an office, a neighbour's door — and it's cut before anyone else sees the walkthrough.",
  timelineHeading: "Your walk",
  timelineHint: "Drag to move through the walk. The frames are from your own recording.",
  scrubberLabel: "Position in the walk",
  markFrom: "Mark as private from here",
  markTo: "…to here",
  remove: "Remove",
  wholeHomeHeading: "Whole home",
  wholeHomeLabel: "The whole walk is the rental — there's nothing private in it",
  wholeHomeLocks: "Untick this to mark private parts.",
  privateRoomHint: "A private room listing always needs its private parts marked.",
  summaryHeading: "What guests will see",
  summaryWhole: "Guests will see the whole walk.",
  summaryNone: "Nothing is marked private yet.",
  summarySegments: (count: number, seconds: number) =>
    `Guests will see ${count} private ${count === 1 ? "part" : "parts"} removed (${seconds} seconds).`,
  segmentRow: (range: string) => `Private: ${range}`,
  send: "Send for verification",
  saveLater: "Save and finish later",
  sending: "Sending…",
  saved: "Saved. You can finish this later.",
  sent: "Sent for verification.",
  /** Shown while the host has answered nothing yet; the send button waits on it. */
  sendBlocked: "Mark private parts, or confirm the whole walk is the rental.",
  /** A re-mask on a live walkthrough (journeys §6). */
  liveStaysUp: "Your current walkthrough stays up until the new one is verified.",
  /** A crop job that didn't finish (HM-D05 §4). */
  cropFailed:
    "We couldn't apply the crop. Try sending again, or mark the private parts on the timeline instead.",
  whatHappensNext:
    "When you send, the walkthrough is rebuilt without the parts you marked. We'll email you when it's verified.",
  /** One sentence in the verified email saying what the host chose. */
  verifiedCoverageCropped: "The parts you marked private are not in it.",
} as const;

/** Subjects for the one email per terminal state (DECISIONS D14). */
export const SCAN_EMAIL_SUBJECTS = {
  needs_mask: (title: string) => `Your walkthrough of ${title} is ready to check`,
  verified: (title: string) => `${title} is verified`,
  rejected: (title: string) => `We couldn't confirm the location for ${title}`,
  failed: (title: string) => `We couldn't process the walk for ${title}`,
} as const;

/**
 * HM-06 — "The street" on listing detail (HM-D08).
 *
 * The precision note is not decoration: a guest is told, in metres, how much
 * the pin was moved, and the alternative sentence is only shown when it was
 * not moved at all. Saying "approximate" without a number would be the sort
 * of soft claim this product exists to avoid.
 */
export const STREET_COPY = {
  heading: "The street",
  /** Reuses the locked imagery labels; the approach is the host's own footage. */
  imagery: HONESTY_NEARBY.imagery,
  /** The host filmed an approach, but this viewer is not entitled to it yet. */
  approachWithheld: "The host shows the approach to guests with a confirmed stay.",
  pinRounded: (metres: number) => `Pin shown to the nearest ${metres} m until a stay is confirmed.`,
  pinExact: "Pin shows the front door.",
  mapLabel: (title: string) => `Map showing the area of ${title}`,
  mapFailed: "The map couldn't load.",
  /** Shown in place of the map, so a failed tile fetch still leaves a fact. */
  place: (city: string, region: string | null) => (region ? `${city}, ${region}` : city),
  ownerPreview: "Guests see this pin at the precision you chose below.",
  /** The editor setting, in "Where it is". */
  setting: {
    label: "Who can see the approach and exact pin",
    hint: "The walkthrough inside is unaffected by this.",
    options: {
      confirmed_stay: "Guests with a confirmed stay (default)",
      everyone: "Everyone",
    },
  },
} as const;

/**
 * The guest's walk (HM-D06 / HM-D07). Nothing here promises motion, a tour or
 * a preview: the camera is stationary until the guest moves it, and every
 * fallback shows real frames rather than a stand-in.
 */
export const WALK_COPY = {
  /** The listing-detail section and the button into the walk. */
  heading: "Walk through this home",
  enter: "Walk through this home",
  leave: "Leave the walkthrough",
  /** The walk's own chrome. */
  controls: "Controls",
  controlMap: "Look around: drag, or arrow keys · Move: on-screen arrows, or W A S D · Leave: Esc or Back",
  gotIt: "Got it",
  moveForward: "Move forward",
  moveBack: "Move back",
  moveLeft: "Move left",
  moveRight: "Move right",
  /** Loading is a count of real megabytes, never a spinner alone. */
  loading: (loadedMb: number, totalMb: number) =>
    `Loading the walkthrough… ${loadedMb} MB of ${totalMb} MB`,
  loadingUnknown: "Loading the walkthrough…",
  canvasLabel: (title: string) => `3D walkthrough of ${title}, captured by the host`,
  /** Reduced motion and no-WebGL both land on real frames. */
  stillsCaption: "Stills from the host's walk",
  showThreeD: "Show the 3D walkthrough",
  reducedMotion:
    "Your device asks for reduced motion, so we're showing stills. The walkthrough never moves on its own.",
  loadFailed: "We couldn't load the walkthrough.",
  /** The host looking at their own unpublished home. */
  ownerPreview: "Guests will see this walk once the home is published.",
} as const;

/** One-line mentions HM-00 adds to existing pages. The only edits to those pages in this phase. */
export const HONESTY_MENTIONS = {
  /** `/for-homeowners`, the "Get ready for bookings" step body. */
  forHomeownersStep:
    "Review your price and policy, set up payouts with Stripe, and walk-scan your home so guests can see the real place.",
  /** `/for-homeowners`, FAQ item after "When can a renter pay for a stay?". */
  forHomeownersFaq: {
    q: "What is the honesty scan?",
    a: "Before a home can take bookings, you film a walk through it on your phone. Your phone's location is checked against the home's location while you walk, and the footage becomes a 3D walkthrough guests can explore. We stitch and stabilise it — we never invent rooms.",
  },
  /** `/host/start`, under the "What setup covers" list on the signed-out card. */
  hostStartSetup: "Then: a walk-scan of the home, before guests can book.",
} as const;

/**
 * The verb list for honesty-media surfaces. Anything not in `allowed` needs
 * a copy review. Anything in `banned` fails the copy test wherever it
 * appears — including a control that is disabled "for later".
 */
export const HONESTY_VERBS = {
  allowed: [
    "Start the walk",
    "Pause",
    "Resume",
    "Finish the walk",
    "Walk again",
    "Continue the walk",
    "Finish uploading",
    "Check progress",
    "See what happened",
    "Check again",
    "Mark private rooms",
    "Keep this area",
    "Mark as private",
    "Mark as private from here",
    "…to here",
    "Remove",
    "Save and finish later",
    "Confirm whole home",
    "Send for verification",
    "View the walkthrough",
    "Walk through this home",
    "Enter the home",
    "Leave the walkthrough",
    "Step outside",
    "Go inside",
    "Show the 3D walkthrough",
    "Show stills instead",
    "About this walkthrough",
    "Confirm the home's location",
    "Use my location here",
    "Scan this home",
    "Publish this home",
    "Try again",
    "Try processing again",
  ],
  banned: [
    "Enhance",
    "Beautify",
    "Improve",
    "Tidy",
    "Clean up this room",
    "Complete the room",
    "Fill in",
    "Auto-fix",
    "Magic",
    "Preview while we wait",
    "AI-generated preview",
    "Live",
    "Verified by GPS",
    "Tamper-proof",
    "Court-grade",
  ],
} as const;

/** The platform-wide banned vocabulary from CLAUDE.md, for the same test. */
export const PLATFORM_BANNED_WORDS = [
  "blockchain",
  "crypto",
  "wallet",
  "token",
  "web3",
  "DAO",
  "smart contract",
  "on-chain",
  "gas",
] as const;
