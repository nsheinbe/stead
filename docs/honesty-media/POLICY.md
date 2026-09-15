# Honesty policy — reviewer checklist (HM-00)

The rule a reviewer can quote: **stitch / stabilise / compress / cleanup
only.** No generative step, no beautify control, no invented geometry.
Provenance is a signal, not proof.

Locked strings live in `src/lib/honestyCopy.ts` (the app) and are
specified in
[`design/honesty-media/JOURNEYS-AND-COPY.md`](../../design/honesty-media/JOURNEYS-AND-COPY.md) §1.
`tests/honesty-copy.test.ts` enforces the ban lists. Policy version:
`HONESTY_POLICY_VERSION` (currently 1); HM-02 snapshots it onto each scan.

Every honesty-media PR answers each line below in its description.

## Reconstruction and media

- [ ] The pipeline performs only: frame extraction, pose estimation,
      splat training on captured frames, crop, compress, stabilise,
      cleanup of captured frames. Nothing synthesises geometry, texture or
      pixels the host did not capture.
- [ ] No model or dependency in the hard-avoid list (INRIA 3DGS NC,
      DUSt3R / MASt3R NC, Luma or other closed reconstruction APIs, OpenMVS
      as hosted core, Mapillary as the sole outdoor layer). Licences
      re-read at the pinned commit and recorded.
- [ ] A failed reconstruction stays `failed` with an honest retry; no
      "preview while we wait", no partial or generated stand-in.
- [ ] Stills shown to guests or hosts are real captured frames chosen by
      the worker.

## Controls and copy

- [ ] No control named Enhance, Beautify, Improve, Tidy, Clean up, Complete
      the room, Fill in, Auto-fix, Magic — visible, hidden, or disabled.
- [ ] Every string comes from `src/lib/honestyCopy.ts`; none retyped.
- [ ] "Captured {date}" is listing-local; nothing says "live".
- [ ] Failure states use ink and warning tones; the claim / danger red is
      for claims, disputes, and load / save failures only.
- [ ] `BOOKINGS_CLOSED_COPY` and `GUEST_BOOKINGS_CLOSED_MESSAGE` unchanged;
      the scan refusal uses different words.

## Location and provenance

- [ ] Continuous geolocation samples with accuracy, judged on the server.
      A single EXIF tag, an IP lookup, or the listing's own coordinates are
      never a sample.
- [ ] The geofence verdict, scan state, `verified`, artifact URLs and
      publish eligibility are computed server-side; the browser shows what
      it was told.
- [ ] The route is never shown to other members or stored in a public
      artifact.
- [ ] Copy never claims courtroom GPS, tamper-proof hardware, or that
      optional integrity APIs make a capture incontestable.

## Gates and inventory

- [ ] `ALLOW_GUEST_BOOKINGS` is exact-`1` only; not set in Production, CI
      defaults, deploy docs or `.env.example` recommendations.
- [ ] Listing status, front-door confirmation, scan verification, payout
      readiness and the platform switch stay five separate facts.
- [ ] No seed walkthroughs; hidden demo rows never get a scan; no invented
      pins, streets or "typical block".
- [ ] Private areas the host masked are absent from every guest-served
      artifact; a re-mask never overwrites a live artifact before it is
      re-verified.

Copyright 2026 Stead contributors.
