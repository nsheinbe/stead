/**
 * HM-05 — what the walk route decides before it loads anything heavy.
 *
 * Pure, so the rules are testable without a GPU: whether this device can
 * render at all, whether the guest asked for reduced motion, and how a byte
 * count becomes the honest "12 MB of 38 MB" line. The viewer chunk is only
 * imported once `canRender` has said yes, so a guest on a browser without
 * WebGL never downloads Three.js.
 */

/** What the walk shows first. `stills` is a real fallback, never a stand-in. */
export type WalkMode = "three_d" | "stills";

export type DeviceSupport = {
  webgl: boolean;
  reducedMotion: boolean;
};

/**
 * A real context probe, not a user-agent guess. The context is released
 * immediately: this only answers whether one can be had at all.
 */
export function detectWebgl(doc: Pick<Document, "createElement"> = document): boolean {
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(win: Pick<Window, "matchMedia"> = window): boolean {
  try {
    return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Reduced motion shows stills and offers the 3D walk as an opt-in; no WebGL
 * shows stills with no offer, because there is nothing to opt into.
 */
export function initialMode(support: DeviceSupport): WalkMode {
  if (!support.webgl) return "stills";
  return support.reducedMotion ? "stills" : "three_d";
}

/** Whether the stills view should offer the 3D opt-in (HM-D07 §4). */
export function offersThreeD(support: DeviceSupport, mode: WalkMode): boolean {
  return support.webgl && mode === "stills";
}

const MB = 1024 * 1024;

/** Whole megabytes, so the progress line counts something a person recognises. */
export function megabytes(bytes: number): number {
  return Math.max(0, Math.round(bytes / MB));
}

export type LoadProgress = { loadedBytes: number; totalBytes: number | null };

/**
 * The progress line, or null when the size is unknown — in which case the
 * caller shows the plain "Loading the walkthrough…" rather than inventing a
 * denominator.
 */
export function progressParts(progress: LoadProgress): { loadedMb: number; totalMb: number } | null {
  if (!progress.totalBytes || progress.totalBytes <= 0) return null;
  return {
    loadedMb: megabytes(Math.min(progress.loadedBytes, progress.totalBytes)),
    totalMb: megabytes(progress.totalBytes),
  };
}

/**
 * A signed URL is short-lived, so the walk re-requests the endpoint once when
 * a load fails near the end of the window rather than looping.
 */
export function urlLikelyExpired(issuedAt: number, expiresInSeconds: number, now = Date.now()): boolean {
  return now - issuedAt >= expiresInSeconds * 1000 * 0.8;
}
