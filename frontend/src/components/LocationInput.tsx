import { useEffect, useRef, useState } from "react";

export interface LocationValue {
  latitude: string;
  longitude: string;
  city: string;
  district: string;
}

export const emptyLocation = (): LocationValue => ({
  latitude: "",
  longitude: "",
  city: "",
  district: "",
});

/** Either coordinates or city+district; each pair is all-or-nothing. Mirrors
 *  the server's rule so the agent finds out before they submit. */
export function locationError(v: LocationValue): string | null {
  const hasLat = v.latitude.trim() !== "";
  const hasLng = v.longitude.trim() !== "";
  const hasCity = v.city.trim() !== "";
  const hasDistrict = v.district.trim() !== "";

  if (hasLat !== hasLng) return "Give both latitude and longitude, or neither.";
  if (hasCity !== hasDistrict) return "Give both city and district, or neither.";
  if (!hasLat && !hasCity) return "Provide coordinates or city and district.";
  return null;
}

export default function LocationInput({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
}) {
  const [geoState, setGeoState] = useState<"idle" | "asking" | "ok" | "denied">(
    "idle",
  );
  // The geolocation callback fires long after mount. Reading `value` from the
  // mount closure would clobber anything the agent typed while waiting.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("ok");
        onChange({
          ...latest.current,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
      },
      // Denial is expected and must not block the form - city and district
      // satisfy the requirement on their own.
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
    // Runs once on mount; re-running would fight the agent's manual edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const error = locationError(value);

  return (
    <fieldset>
      <legend>Location</legend>
      {geoState === "asking" && <p className="muted">Finding your position…</p>}
      {geoState === "denied" && (
        <p className="muted">
          No GPS fix. Type coordinates by hand, or just fill in city and
          district.
        </p>
      )}
      <div className="row">
        <input
          placeholder="Latitude"
          aria-label="Latitude"
          inputMode="decimal"
          value={value.latitude}
          onChange={(e) => onChange({ ...value, latitude: e.target.value })}
        />
        <input
          placeholder="Longitude"
          aria-label="Longitude"
          inputMode="decimal"
          value={value.longitude}
          onChange={(e) => onChange({ ...value, longitude: e.target.value })}
        />
      </div>
      <div className="row">
        <input
          placeholder="City"
          aria-label="City"
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
        />
        <input
          placeholder="District"
          aria-label="District"
          value={value.district}
          onChange={(e) => onChange({ ...value, district: e.target.value })}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </fieldset>
  );
}
