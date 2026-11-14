import { describe, it, expect } from "vitest";
import {
  createStudy,
  decodeStudy,
  isStudy,
  rowAt,
  geometryKey,
  surfaceDistance,
  totals,
  newSatellite,
} from "./study";
import { geoJSON, kml, missionICS, studyJSON, missionCSV } from "./exports";
import type { Geometry } from "./study";
describe("editable study documents", () => {
  it("creates fully valid templates with separate project identities", () => {
    const projects = ["south", "apollo", "farside", "blank"].map(createStudy);
    expect(projects.every(isStudy)).toBe(true);
    expect(new Set(projects.map((p) => p.id)).size).toBe(4);
    expect(projects[2].satellites).toHaveLength(2);
  });
  it("migrates original prototype exports and rejects malformed nested input", () => {
    const p = decodeStudy({
      schema_version: "lunar-window-mvp-v1",
      project: {
        version: 1,
        name: "Old study",
        startA: 0,
        startB: 24,
        duration: 24,
        cursor: 8,
        active: "A",
        alignment: "elapsed",
      },
    });
    expect(p?.site.lat).toBe(-89.5);
    expect(p && isStudy(p)).toBe(true);
    expect(isStudy({ ...createStudy(), satellites: [null] })).toBe(false);
  });
  it("rejects damaged imports and non-lunar coordinate ranges", () => {
    const p = createStudy();
    expect(isStudy({ ...p, site: { ...p.site, lat: 91 } })).toBe(false);
    expect(
      isStudy({ ...p, satellites: [{ ...newSatellite(0), altitude: NaN }] }),
    ).toBe(false);
    expect(isStudy({ ...p, events: [{ ...p.events[0], offset: 25 }] })).toBe(
      false,
    );
  });
  it("recalculates for scientific changes, not visualization or playback", () => {
    const p = createStudy();
    expect(geometryKey({ ...p, cursor: 5, view: "2d" }, "A")).toBe(
      geometryKey(p, "A"),
    );
    expect(geometryKey({ ...p, site: { ...p.site, lon: 100 } }, "A")).not.toBe(
      geometryKey(p, "A"),
    );
    expect(geometryKey({ ...p, start: "2027-01-01T00:00:01Z" }, "A")).not.toBe(
      geometryKey(p, "A"),
    );
  });
  it("exports a round-trip editable study with explicit lunar coordinates", () => {
    const p = createStudy("farside");
    const result = JSON.parse(studyJSON(p));
    expect(isStudy(result.study)).toBe(true);
    expect(geoJSON(p).planetary_reference.body).toBe("Moon");
    expect(kml(p)).toContain("target=moon");
    expect(kml({ ...p, name: "A < B & C" })).toContain("A &lt; B &amp; C");
  });
  it("measures geodesic distances across the antimeridian", () => {
    expect(surfaceDistance([179, 0], [-179, 0])).toBeCloseTo(
      (1737.4 * Math.PI) / 90,
      6,
    );
    expect(surfaceDistance([0, 0], [0, 0])).toBe(0);
  });
  it("exports UTC mission activities and correctly quotes CSV notes", () => {
    const p = createStudy();
    p.events[0].name = 'Landing, "check"';
    expect(missionCSV(p)).toContain('"Landing, ""check"""');
    expect(missionICS(p)).toContain("DTSTART:20261114T000000Z");
    expect(missionICS(p)).toContain("END:VCALENDAR");
  });
});
describe("geometry interpolation and coverage", () => {
  const body = (az: number, elevation: number) => ({
    azimuth: az,
    elevation,
    radius: 1,
    vector: [1, 0, 0],
  });
  const g = {
    rows: [
      {
        time: "2026-11-14T00:00:00Z",
        elapsed: 0,
        sun: body(359, 10),
        earth: body(0, -1),
        satellites: {},
      },
      {
        time: "2026-11-14T01:00:00Z",
        elapsed: 1,
        sun: body(1, 12),
        earth: body(0, -1),
        satellites: {},
      },
    ],
    orbits: {},
    input: {},
    method: {},
    kernels: [],
  } satisfies Geometry;
  it("wraps azimuth across north and interpolates seconds without extrapolation", () => {
    expect(rowAt(g, "2026-11-14T00:30:00Z")?.sun.azimuth).toBe(0);
    expect(rowAt(g, "2026-11-14T00:30:00Z")?.sun.elevation).toBe(11);
    expect(rowAt(g, "2026-11-13T23:59:59Z")).toBeNull();
  });
  it("integrates half-open durations with no endpoint double counting", () => {
    expect(totals(g)).toEqual({ sun: 1, earth: 0, overlap: 0 });
  });
});
