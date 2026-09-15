# Honesty policy — engineering appendix (HM-00)

**Version:** `1` (`HONESTY_POLICY_VERSION` in `src/lib/honesty.ts`). A host
acknowledges this version before the first frame, and the scan row keeps it.
Bump the version when the host or guest disclosure changes in substance, not
for a typo.

**Source of the words:** [`design/honesty-media/JOURNEYS-AND-COPY.md`](../../design/honesty-media/JOURNEYS-AND-COPY.md)
§8 (disclosures) and §9 (every string, by `hm.*` id). `src/lib/honesty.ts`
mirrors that file and `tests/honesty-copy.test.ts` fails when they drift.

Copyright 2026 Stead contributors.

---

## 1. The rule a reviewer can quote

**Reconstruction is stitch / stabilize / compress / cleanup only.** Cleanup
means removing capture noise and floaters; it never fills the gap it leaves.

Allowed: stitching frames; stabilizing; compressing; cropping to the rental
volume; hiding host-marked private boxes; removing floaters and capture
noise.

Forbidden, in any worker, viewer or control: inpainting or generative fill;
invented geometry, rooms, furniture, façades or views; hallucinating
super-resolution; style transfer or relighting; sky or window-view
replacement; virtual staging; any closed reconstruction API; any model whose
license is non-commercial.

## 2. Words that never appear in the product

**UI verbs and labels** (not even disabled, not even in a tooltip): Enhance ·
Beautify · Retouch · Tidy · Declutter · Complete the room · Fill · Auto-fix ·
Magic · Clean up (as a control) · Generate · Reimagine · Stage · Virtual
staging · Render (as a verb on a room) · Upscale · Restore · Smart erase ·
Remove object.

**Provenance claims**: GPS-certified · tamper-proof · court-admissible ·
verified by hardware attestation · 100% real · live now. Say instead:
geo-proven, a strong signal, not a guarantee.

**House bans** (all Stead copy): blockchain, crypto, wallet, web3, DAO, smart
contract, on-chain, gas.

`HONESTY_BANNED_TERMS` in `src/lib/honesty.ts` is the machine-readable list;
the copy test sweeps every string against it.

## 3. What a host is told, and when

Before the first frame, on the pre-capture sheet (`hm.sheet.*`): what is
recorded (video, continuous location), why location (to prove the walk
happened at this home; guests never see the route), what reconstruction does
and does not do, that private areas are cut out, and that a home cannot take
bookings until its walkthrough is verified. The host ticks an acknowledgment
that records the policy version with the scan.

## 4. What a guest is told, on every walkthrough

The badge, locked: **Geo-proven walkthrough · Captured by the host ·
Stitched, not invented.** Under it: the capture date in the listing's time
zone (never "live"), whole home versus rental areas only, and the long
disclosure (`hm.about.*`) reachable from the badge. Guest surfaces arrive
with HM-05; the strings are locked now.

## 5. The gates, kept separate

| Gate | Set by | This phase |
| --- | --- | --- |
| Platform kill-switch `ALLOW_GUEST_BOOKINGS` | Nick, on Vercel Production, exact string `1` | Untouched. Unset, `0`, `true`, `yes` all refuse create-booking. |
| Listing scan-verified | Server / worker | HM-08 enforces it before publish and bookable. HM-01 only records the location verdict. |
| Payout-ready | Stripe | Unchanged. |

A verified scan never opens bookings. Publishing never verifies a scan.

## 6. What HM-01 enforces today

`server/lib/geofence.ts`, thresholds from `app_config` and frozen onto each
scan when it starts:

| Key | Default | Meaning |
| --- | --- | --- |
| `scan_accuracy_max_meters` | 25 | A "good" fix. Required for outdoor bookend samples. |
| `scan_geofence_radius_meters` | 60 | Reach around the front door pin. |
| `scan_indoor_tolerance_meters` | 500 | Cap on how much a rough fix may excuse. |
| `scan_min_samples` | 20 | Fewer and nothing can be said. |
| `scan_bookend_min_samples` | 3 | Good samples needed at each of start and end. |
| `scan_max_gap_seconds` | 45 | A wider quiet spell is where a splice would be. |
| `scan_max_walk_minutes` | 20 | Capture length the client enforces. |

Verdicts: `samples` (too few, a gap, no indoor part), `bookends` (phases
missing or out of order), `accuracy` (bookends present but too rough),
`geofence` (a sample beyond reach). EXIF is never consulted. Network or IP
geolocation is never used, for the pin or the walk. The browser never
displays a verdict it computed.

Copyright 2026 Stead contributors.
