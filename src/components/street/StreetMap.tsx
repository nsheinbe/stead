/**
 * HM-06 — the map on listing detail (HM-D08 §3).
 *
 * Lazy-loaded: MapLibre is not small, and Explore, checkout and the host
 * surfaces have no map, so nothing but this section pays for it.
 *
 * Two rules the code keeps, not just the copy:
 *
 *  - **One pin, where the server put it.** The component receives a point and
 *    renders it. It never rounds, offsets or "improves" the coordinate; by the
 *    time a pin reaches the browser the precision decision has been made and
 *    a client-side adjustment could only undo it.
 *  - **A failure is said out loud.** Tiles come from a third party, so they
 *    can be blocked, rate-limited or simply down. Any of that calls `onFailed`
 *    and the section replaces the map with the place name — never a blank grey
 *    box pretending to be a map.
 */
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleUrl } from "../../lib/streetMap";

export type StreetMapProps = {
  lat: number;
  lng: number;
  zoom: number;
  /** Accessible name; the same place text is rendered beside the map too. */
  label: string;
  onFailed: () => void;
};

export function StreetMap({ lat, lng, zoom, label, onFailed }: StreetMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  // The failure handler lives in a ref so a re-render never re-creates the map.
  const failed = useRef(onFailed);
  failed.current = onFailed;

  useEffect(() => {
    const container = holder.current;
    if (!container) return;

    let map: maplibregl.Map | null = null;
    try {
      map = new maplibregl.Map({
        container,
        style: mapStyleUrl(),
        center: [lng, lat],
        zoom,
        // Nothing moves on its own here either: no rotation, no auto-fly.
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
      });
    } catch {
      failed.current();
      return;
    }

    // Style, tile and network failures all arrive here.
    map.on("error", () => failed.current());
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    new maplibregl.Marker({ color: "#1E4034" }).setLngLat([lng, lat]).addTo(map);

    return () => {
      map?.remove();
    };
  }, [lat, lng, zoom]);

  return <div ref={holder} className="h-full w-full" role="img" aria-label={label} data-testid="street-map" />;
}

export default StreetMap;
