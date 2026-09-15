import { useEffect, useState } from "react";
import { HM, hm } from "../../lib/honesty";
import { Button, Dialog, StatusMessage, TextInput } from "../ui";

/**
 * A fix rougher than this is not a front door, whatever the phone says. It
 * is the guard against a desktop browser's network-based position landing in
 * the field; the honesty scan itself is judged by the server later.
 */
const PIN_FIX_MAX_METERS = 100;

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/**
 * The front door pin block in the editor's "Where it is" card (HM-D02).
 *
 * Two ways in: type decimal degrees, or on a phone, use its location while
 * standing at the door and confirm what came back with its accuracy stated.
 * No map yet: MapLibre and a tile source arrive with HM-06, and until then a
 * typed pair is the honest manual path rather than a hidden one. Never a
 * network or IP guess, and never a default the host did not choose.
 */
export function FrontDoorPin({
  latId,
  lngId,
  lat,
  lng,
  error,
  savedLat,
  savedLng,
  scanLive,
  onChange,
}: {
  latId: string;
  lngId: string;
  lat: string;
  lng: string;
  error?: string;
  savedLat: number | null;
  savedLng: number | null;
  /** A scan exists that a pin change would take down. */
  scanLive: boolean;
  onChange: (lat: string, lng: string) => void;
}) {
  const phone = usePhone();
  const [finding, setFinding] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  const geolocationAvailable = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const pinSet = savedLat !== null && savedLng !== null && lat === String(savedLat) && lng === String(savedLng);
  const dirty = !pinSet && (lat.trim() !== "" || lng.trim() !== "");

  const useMyLocation = () => {
    setFixError(null);
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFinding(false);
        const accuracy = Math.max(0, Math.round(position.coords.accuracy));
        if (accuracy > PIN_FIX_MAX_METERS) {
          setFixError(hm("hm.pin.roughFix", { accuracy }));
          return;
        }
        setCandidate({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy });
      },
      () => {
        setFinding(false);
        setFixError(HM["hm.pin.noFix"]);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  };

  return (
    <div className="flex flex-col gap-4 border-t border-divider pt-5">
      <div>
        <h3 className="m-0 text-base font-semibold">{HM["hm.pin.title"]}</h3>
        <p className="mb-0 mt-1 text-sm text-ink-secondary">{HM["hm.pin.hint"]}</p>
      </div>

      {scanLive ? <StatusMessage tone="warning" live={false} title={HM["hm.pin.changeWarning"]} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          id={latId}
          label={HM["hm.pin.lat"]}
          hint={HM["hm.pin.advanced.hint"]}
          inputMode="decimal"
          className="money"
          value={lat}
          error={error}
          onChange={(e) => onChange(e.target.value, lng)}
        />
        <TextInput
          id={lngId}
          label={HM["hm.pin.lng"]}
          inputMode="decimal"
          className="money"
          value={lng}
          onChange={(e) => onChange(lat, e.target.value)}
        />
      </div>

      <p role="status" className="m-0 text-sm text-ink-secondary">
        {pinSet ? HM["hm.pin.saved"] : dirty ? HM["hm.pin.unsaved"] : ""}
      </p>

      {phone && geolocationAvailable ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" size="sm" className="self-start" busy={finding} busyLabel="Finding you…" onClick={useMyLocation}>
            {HM["hm.pin.useLocation"]}
          </Button>
          <p className="m-0 text-sm text-ink-secondary">{HM["hm.pin.useLocation.hint"]}</p>
        </div>
      ) : null}

      {fixError ? <StatusMessage tone="info" title={fixError} /> : null}

      <Dialog
        open={candidate !== null}
        onClose={() => setCandidate(null)}
        title={HM["hm.pin.confirm.title"]}
        description={candidate ? hm("hm.pin.confirm.accuracy", { accuracy: candidate.accuracy }) : undefined}
        size="sm"
      >
        <p className="money m-0 text-sm text-ink-secondary">
          {candidate ? `${candidate.lat.toFixed(6)}, ${candidate.lng.toFixed(6)}` : ""}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            onClick={() => {
              if (candidate) onChange(candidate.lat.toFixed(6), candidate.lng.toFixed(6));
              setCandidate(null);
            }}
          >
            {HM["hm.pin.confirm.yes"]}
          </Button>
          <Button variant="secondary" onClick={() => setCandidate(null)}>
            {HM["hm.pin.confirm.no"]}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
