import fixture from "../../data/ephemeris-fixture.json";
import manifest from "../../data/manifest.json";
import terrainContext from "./terrain-metadata.json";
export const HOUR = 3_600_000;
export const EPOCH = Date.parse(fixture.bodies.sun[0].time_utc);
export const COVERAGE_HOURS = 48;
export type Sample = {
  time_utc: string;
  azimuth_deg: number;
  elevation_deg: number;
  angular_radius_deg: number;
};
export type Body = "sun" | "earth";
export type Project = {
  version: 1;
  name: string;
  startA: number;
  startB: number;
  duration: number;
  cursor: number;
  active: "A" | "B";
  alignment: "elapsed" | "utc";
};
export const DEFAULT: Project = {
  version: 1,
  name: "South pole study",
  startA: 0,
  startB: 24,
  duration: 24,
  cursor: 8,
  active: "A",
  alignment: "elapsed",
};
export const data = fixture;
export const sourceManifest = manifest;
export function validProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const p = value as Project;
  return (
    p.version === 1 &&
    typeof p.name === "string" &&
    p.name.length <= 100 &&
    ["A", "B"].includes(p.active) &&
    ["elapsed", "utc"].includes(p.alignment) &&
    [p.startA, p.startB, p.duration, p.cursor].every(Number.isFinite) &&
    Number.isInteger(p.startA) &&
    Number.isInteger(p.startB) &&
    [6, 12, 24].includes(p.duration) &&
    p.startA >= 0 &&
    p.startB >= 0 &&
    Math.max(p.startA, p.startB) + p.duration <= 48 &&
    p.cursor >= 0 &&
    p.cursor <= p.duration
  );
}
export function sample(body: Body, hour: number): Sample | null {
  if (!Number.isFinite(hour) || hour < 0 || hour > COVERAGE_HOURS) return null;
  const rows = fixture.bodies[body];
  const a = rows[Math.floor(hour)],
    b = rows[Math.min(Math.ceil(hour), 48)];
  const t = hour - Math.floor(hour);
  const azimuthDelta = ((b.azimuth_deg - a.azimuth_deg + 540) % 360) - 180;
  return {
    time_utc: new Date(EPOCH + hour * HOUR).toISOString(),
    azimuth_deg: (a.azimuth_deg + azimuthDelta * t + 360) % 360,
    elevation_deg: a.elevation_deg + (b.elevation_deg - a.elevation_deg) * t,
    angular_radius_deg:
      a.angular_radius_deg + (b.angular_radius_deg - a.angular_radius_deg) * t,
  };
}
export function diskState(row: Sample | null) {
  if (!row) return "Outside coverage";
  if (row.elevation_deg > row.angular_radius_deg) return "Full disk above";
  if (row.elevation_deg < -row.angular_radius_deg) return "Below reference";
  return "Partial disk above";
}
export function referenceHours(body: Body, start: number, duration: number) {
  // Left-sampled hourly screening measure. Endpoint is not an extra interval.
  return Array.from({ length: duration }, (_, i) =>
    sample(body, start + i),
  ).filter((row) => row && row.elevation_deg > 0).length;
}
export function selectedHour(p: Project, scenario: "A" | "B") {
  const start = scenario === "A" ? p.startA : p.startB;
  const hour =
    p.alignment === "elapsed" ? start + p.cursor : p.startA + p.cursor;
  return hour >= start && hour <= start + p.duration ? hour : null;
}
export function utc(hour: number) {
  return new Date(EPOCH + hour * HOUR)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}
export function exportProject(p: Project) {
  return {
    schema_version: "lunar-window-mvp-v1",
    project: p,
    observer: fixture.observer,
    frame: fixture.frame,
    terrain_context: terrainContext,
    coverage: {
      start_utc: new Date(EPOCH).toISOString(),
      end_utc: new Date(EPOCH + 48 * HOUR).toISOString(),
      sample_step_seconds: 3600,
    },
    method: {
      version: "ideal-reference-v1",
      horizon_elevation_deg: 0,
      terrain_available: false,
      display_interpolation: "linear; shortest-arc azimuth",
      duration_metrics:
        "hourly left-sampled center above 0 degrees; [start,end)",
      eclipses: "not modeled",
    },
    limitations: [
      ...fixture.limitations,
      "Terrain context is at a different coordinate",
      "Earth line of sight is not station access or a communications link",
      "Zero-degree reference plane is not a terrain horizon",
    ],
    source_manifest: manifest,
    samples: {
      A: exportRows(p.startA, p.duration),
      B: exportRows(p.startB, p.duration),
    },
  };
}
export function exportRows(start: number, duration: number) {
  return Array.from({ length: duration + 1 }, (_, elapsed) => ({
    elapsed_hours: elapsed,
    sun: sample("sun", start + elapsed),
    earth: sample("earth", start + elapsed),
  }));
}
export function csv(p: Project) {
  const meta = [
    "# lunar-window-mvp-v1; ideal-reference-v1; astronomy only; terrain unavailable",
    `# observer_latitude_deg=-89.5; observer_longitude_east_deg=0; reference_altitude_km=0; frame=${fixture.frame}`,
    `# alignment=${p.alignment}; sample_step_seconds=3600; eclipse_model=none; endpoint_included=true`,
    "# terrain context is a separate location; durations use left samples over [start,end)",
    ...manifest.assets
      .filter(
        (asset) =>
          asset.path.includes("horizons.json") ||
          asset.path.includes("ephemeris-fixture.json"),
      )
      .map((asset) => `# sha256 ${asset.path} ${asset.sha256}`),
  ];
  const rows = [
    "scenario,time_utc,elapsed_hours,body,azimuth_deg,elevation_deg,angular_radius_deg,terrain_available",
  ];
  for (const id of ["A", "B"] as const)
    for (const row of exportRows(id === "A" ? p.startA : p.startB, p.duration))
      for (const body of ["sun", "earth"] as const) {
        const s = row[body]!;
        rows.push(
          `${id},${s.time_utc},${row.elapsed_hours},${body},${s.azimuth_deg},${s.elevation_deg},${s.angular_radius_deg},false`,
        );
      }
  return [...meta, ...rows].join("\n");
}
