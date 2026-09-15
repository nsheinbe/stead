/**
 * HM-05 — the 3D walk itself. Lazy-loaded: this module pulls in Three.js and
 * Spark, so nothing but the walk route ever pays for them.
 *
 * Two rules the code has to keep, not just the copy:
 *
 *  - **Nothing moves on its own.** The camera is placed once and then only
 *    `SparkControls` moves it, and only from a key, a drag or one of the
 *    on-screen buttons. There is no easing, no auto-orbit, no intro fly-in.
 *  - **Nothing is invented.** The only thing rendered is the artifact the
 *    server signed. A load failure is reported upward so the page can show
 *    real frames instead; it never falls back to a stand-in scene.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SparkControls, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { WALK_COPY } from "../../lib/honestyCopy";
import type { LoadProgress } from "../../lib/walkthrough";

export type SplatViewerProps = {
  /** Short-lived signed URL for the mask-applied artifact. */
  url: string;
  title: string;
  onProgress: (progress: LoadProgress) => void;
  onReady: () => void;
  /** Called for a failed load or a lost context; the page shows stills. */
  onFailed: () => void;
};

/** Where the guest stands when the walk opens, until they move. */
const START_HEIGHT_M = 1.6;

export function SplatViewer({ url, title, onProgress, onReady, onFailed }: SplatViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moveRef = useRef<THREE.Vector3 | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  // The callbacks come from a component that re-renders on progress, so hold
  // them in refs: the effect below must run once per URL, not once per frame.
  const handlers = useRef({ onProgress, onReady, onFailed });
  handlers.current = { onProgress, onReady, onFailed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let mesh: SplatMesh | null = null;

    // antialias off: it costs a lot and does nothing for splat rendering.
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    } catch {
      handlers.current.onFailed();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
    // The rig is what the controls move; the camera hangs off it at eye height.
    const rig = new THREE.Object3D();
    rig.add(camera);
    camera.position.set(0, START_HEIGHT_M, 0);
    scene.add(rig);
    scene.add(new SparkRenderer({ renderer }));

    const controls = new SparkControls({ canvas });
    moveRef.current = controls.fpsMovement.extraMove;

    const resize = () => {
      if (!renderer || disposed) return;
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      handlers.current.onFailed();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    mesh = new SplatMesh({
      url,
      onProgress: (event: ProgressEvent) => {
        handlers.current.onProgress({
          loadedBytes: event.loaded,
          totalBytes: event.lengthComputable ? event.total : null,
        });
      },
      onLoad: () => {
        if (!disposed) handlers.current.onReady();
      },
    });
    scene.add(mesh);
    mesh.initialized.catch(() => {
      if (!disposed) handlers.current.onFailed();
    });

    renderer.setAnimationLoop(() => {
      if (!renderer || disposed) return;
      // Moves the rig only when there is input. Nothing here animates.
      controls.update(rig, camera);
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      renderer?.setAnimationLoop(null);
      mesh?.dispose();
      renderer?.dispose();
      moveRef.current = null;
    };
  }, [url]);

  // -- on-screen movement, so nothing needs a keyboard or a pointer drag ----
  const push = useCallback((axis: "x" | "z", amount: number, key: string) => {
    const move = moveRef.current;
    if (move) move[axis] = amount;
    setHeld(amount === 0 ? null : key);
  }, []);

  const button = (key: string, label: string, axis: "x" | "z", amount: number, glyph: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={held === key}
      className="flex h-12 w-12 items-center justify-center rounded-control bg-canvas/90 text-lg font-semibold text-ink shadow-sm"
      onPointerDown={() => push(axis, amount, key)}
      onPointerUp={() => push(axis, 0, key)}
      onPointerLeave={() => push(axis, 0, key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") push(axis, amount, key);
      }}
      onKeyUp={() => push(axis, 0, key)}
      onBlur={() => push(axis, 0, key)}
      data-testid={`walk-${key}`}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={WALK_COPY.canvasLabel(title)}
        className="h-full w-full touch-none"
        data-testid="walk-canvas"
      />
      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col items-center gap-2">
        <div className="pointer-events-auto">{button("forward", WALK_COPY.moveForward, "z", -1, "↑")}</div>
        <div className="pointer-events-auto flex gap-2">
          {button("left", WALK_COPY.moveLeft, "x", -1, "←")}
          {button("back", WALK_COPY.moveBack, "z", 1, "↓")}
          {button("right", WALK_COPY.moveRight, "x", 1, "→")}
        </div>
      </div>
    </>
  );
}

export default SplatViewer;
