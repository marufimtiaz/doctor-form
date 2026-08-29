import { describe, expect, it } from "vitest";

import {
  parseStoredSession,
  serializeSession,
  type StoredSession,
} from "@/lib/hospitalSession";

const session: StoredSession = {
  hospital: {
    hospital_name: "Square Hospital",
    has_emergency_service: true,
    city: "Dhaka",
    district: "Dhaka",
    latitude: "",
    longitude: "",
    phones: [{ value: "01712345678" }],
  },
  doctorsAdded: 2,
};

describe("parseStoredSession", () => {
  it("round-trips a session through serialize", () => {
    expect(parseStoredSession(serializeSession(session))).toEqual(session);
  });

  it("returns null for a missing key", () => {
    expect(parseStoredSession(null)).toBeNull();
  });

  it("returns null for text that is not JSON", () => {
    expect(parseStoredSession("not json at all")).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    expect(parseStoredSession("42")).toBeNull();
  });

  it("returns null when the hospital is missing", () => {
    expect(parseStoredSession(JSON.stringify({ doctorsAdded: 1 }))).toBeNull();
  });

  it("returns null when the hospital has no name", () => {
    const bad = { ...session, hospital: { ...session.hospital, hospital_name: "" } };
    expect(parseStoredSession(JSON.stringify(bad))).toBeNull();
  });

  it("falls back to a zero count when doctorsAdded is not a number", () => {
    const odd = { ...session, doctorsAdded: "many" };
    expect(parseStoredSession(JSON.stringify(odd))?.doctorsAdded).toBe(0);
  });

  it("falls back to a zero count when doctorsAdded is negative", () => {
    const odd = { ...session, doctorsAdded: -3 };
    expect(parseStoredSession(JSON.stringify(odd))?.doctorsAdded).toBe(0);
  });
});
