import type { LunarPoint } from "./surfaceRoutes";
import { validRouteMetadata } from "./surfaceRoutes";
import type { RouteMetadata } from "./surfaceRoutes";
import { validSiteSearch } from "./recommendations";
import type { ProjectTask } from "./TasksPanel";
import type { SiteSearch } from "./recommendations";
import { validScience } from "./science";
import type { ScienceConfig, ScienceResult } from "./science";
import {
  validProject as isLegacyProject,
  EPOCH as LEGACY_EPOCH,
  HOUR as LEGACY_HOUR,
} from "./model";
export type Site = { name: string; lat: number; lon: number; height: number };
export type Satellite = {
  ephemeris?: "LRO-2022";
  id: string;
  name: string;
  altitude: number;
  inclination: number;
  raan: number;
  phase: number;
  color: string;
  visible: boolean;
};
export type Annotation = {
  id: string;
  kind: "point" | "line" | "polygon";
  route?: RouteMetadata;
  name: string;
  note: string;
  color: string;
  coordinates: [number, number][];
};
export type MissionEvent = {
  id: string;
  name: string;
  offset: number;
  duration: number;
  type: "landing" | "ascent" | "science" | "communication" | "traverse" | "power";
  notes: string;
  done: boolean;
  stopId?: string;
  stopActivity?: "study" | "charge";
};
export type MissionStopActivity = { enabled: boolean; duration: number; offset?: number };
export type MissionStop = {
  id: string;
  point: LunarPoint;
  name: string;
  description: string;
  studyActivity?: MissionStopActivity;
  chargeActivity?: MissionStopActivity;
};
export type Study = {
  missionStops?: MissionStop[];
  prohibitedAreas?: LunarPoint[][];
  tasks?: ProjectTask[];
  siteSearch?: SiteSearch;
  stars?: boolean;
  starBlur?: number;
  showRecommendations?: boolean;
  analysis?: ScienceConfig;
  version: 2;
  id: string;
  name: string;
  description: string;
  site: Site;
  compareSite: Site;
  start: string;
  compareStart: string;
  duration: number;
  step: number;
  cursor: number;
  active: "A" | "B";
  alignment: "elapsed" | "utc";
  satellites: Satellite[];
  annotations: Annotation[];
  events: MissionEvent[];
  view: "3d" | "2d" | "oblique";
  layer: "imagery" | "elevation" | "hillshade" | "slope";
  grid: boolean;
  lighting: boolean;
  directions: boolean;
};
export type BodyGeometry = {
  azimuth: number;
  elevation: number;
  radius: number;
  vector: number[];
};
export type GeometryRow = {
  time: string;
  elapsed: number;
  sun: BodyGeometry;
  earth: BodyGeometry;
  satellites: Record<
    string,
    {
      position: number[];
      elevation: number;
      above_reference: boolean;
      model?: string;
      solar_unocculted_fraction?: number;
      solar_state?: string;
      solar_model?: string;
      ephemeris_source?: string;
    }
  >;
};
export type Geometry = {
  analysis?: ScienceResult;
  rows: GeometryRow[];
  orbits: Record<
    string,
    { period_seconds: number | null; positions: number[][] }
  >;
  method: Record<string, unknown>;
  input: unknown;
  kernels: string[];
};
export const uid = () => crypto.randomUUID();
export const SITES: Site[] = [
  { name: "Shackleton rim study", lat: -89.7, lon: -30, height: 0 },
  { name: "Connecting Ridge study", lat: -89.45, lon: -137.5, height: 0 },
  { name: "Apollo 11", lat: 0.67416, lon: 23.47315, height: 0 },
  { name: "Apollo 15", lat: 26.1322, lon: 3.6339, height: 0 },
  { name: "Far side / Von Kármán", lat: -45.4446, lon: 177.5991, height: 0 },
  { name: "North pole study", lat: 89.5, lon: 0, height: 0 },
];
export function createStudy(template = "south"): Study {
  const start = "2026-11-14T00:00:00Z";
  const site =
    (template === "apollo" || template === "traverse")
      ? SITES[2]
      : template === "farside"
        ? SITES[4]
        : SITES[0];
  return {
    version: 2,
    id: uid(),
    name:
      template === "traverse" ? "Apollo traverse practice" : template === "blank"
        ? "Untitled study"
        : template === "apollo"
          ? "Apollo region survey"
          : template === "farside"
            ? "Far side relay study"
            : "South pole mission",
    description: "",
    site: { ...site },
    compareSite: { ...site },
    start,
    compareStart: "2026-11-15T00:00:00Z",
    duration: 24,
    step: 900,
    cursor: 8,
    active: "A",
    alignment: "elapsed",
    satellites:
      template === "farside" ? [newSatellite(0), newSatellite(1)] : [],
    annotations: [],
    ...(template === "traverse" ? {
      missionStops: [
        { id: uid(), point: [23.484, 0.674] as LunarPoint, name: "Sampling station", description: "Collect and label a surface sample." },
        { id: uid(), point: [23.483, 0.681] as LunarPoint, name: "Survey ridge", description: "Record a panorama before returning to the lander." },
      ],
      prohibitedAreas: [[[23.476,0.672],[23.480,0.672],[23.480,0.678],[23.476,0.678]]] as LunarPoint[][],
    } : {}),
    events:
      template === "blank"
        ? []
        : [
            {
              id: uid(),
              name: "Surface arrival",
              offset: 0,
              duration: 0.5,
              type: "landing",
              notes: "Confirm site conditions before beginning operations.",
              done: false,
            },
            {
              id: uid(),
              name: "Initial surface science",
              offset: 2,
              duration: 3,
              type: "science",
              notes: "Review local solar geometry and instrument readiness.",
              done: false,
            },
            {
              id: uid(),
              name: "Earth visibility review",
              offset: 6,
              duration: 0.5,
              type: "communication",
              notes: "Geometry screening only; station access is not modeled.",
              done: false,
            },
          ],
    view: "3d",
    layer: "imagery",
    grid: true,
    lighting: false,
    directions: true,
  };
}
export function newSatellite(index: number): Satellite {
  return {
    id: uid(),
    name: `Relay ${index + 1}`,
    altitude: 100 + index * 50,
    inclination: 90,
    raan: (index * 60) % 360,
    phase: (index * 120) % 360,
    color: ["#7fb7ff", "#ffa56c", "#d2a2ff", "#70deca"][index % 4],
    visible: true,
  };
}
const num = (v: unknown, a: number, b: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
const text = (v: unknown, n = 1000) => typeof v === "string" && v.length <= n;
const siteValid = (s: Site) =>
  s &&
  text(s.name, 100) &&
  num(s.lat, -90, 90) &&
  num(s.lon, -180, 180) &&
  num(s.height, -10000, 100000);
const lunarPoint = (c: unknown) => Array.isArray(c) && c.length === 2
  && num(c[0], -180, 180) && num(c[1], -90, 90);

export function isStudy(value: unknown): value is Study {
  if (!value || typeof value !== "object") return false;
  const s = value as Study;
  try {
    return (
      s.version === 2 &&
      (s.missionStops === undefined || (Array.isArray(s.missionStops) && s.missionStops.length <= 6
        && s.missionStops.every(stop => stop && text(stop.id,100) && lunarPoint(stop.point)
          && text(stop.name,100) && text(stop.description,2000)
          && [stop.studyActivity, stop.chargeActivity].every(activity => activity === undefined || (
            activity && typeof activity.enabled === "boolean" && num(activity.duration, 1, 100000)
            && (activity.offset === undefined || num(activity.offset, 0, s.duration))
          )))
        && new Set(s.missionStops.map(stop => stop.id)).size === s.missionStops.length)) &&
      (s.prohibitedAreas === undefined || (Array.isArray(s.prohibitedAreas) && s.prohibitedAreas.length <= 8
        && s.prohibitedAreas.every(poly => Array.isArray(poly) && poly.length >= 3 && poly.length <= 32 && poly.every(lunarPoint)))) &&
      [s.stars, s.showRecommendations].every(
        (v) => v === undefined || typeof v === "boolean",
      ) &&
      (s.starBlur === undefined || num(s.starBlur, 0, 4)) &&
      (s.siteSearch === undefined || validSiteSearch(s.siteSearch)) &&
      (s.tasks === undefined ||
        (Array.isArray(s.tasks) &&
          s.tasks.length <= 1000 &&
          s.tasks.every(
            (t) =>
              t &&
              text(t.id, 100) &&
              text(t.title, 200) &&
              text(t.note, 5000) &&
              typeof t.done === "boolean",
          ))) &&
      (s.analysis === undefined || validScience(s.analysis)) &&
      text(s.id, 100) &&
      text(s.name, 100) &&
      text(s.description, 20000) &&
      siteValid(s.site) &&
      siteValid(s.compareSite) &&
      [s.start, s.compareStart].every(
        (x) =>
          typeof x === "string" &&
          Number.isFinite(Date.parse(x)) &&
          Date.parse(x) >= Date.parse("1969-01-01") &&
          Date.parse(x) + s.duration * 3600000 <= Date.parse("2050-01-01"),
      ) &&
      num(s.duration, 1 / 60, 744) &&
      num(s.step, 60, 86400) &&
      num(s.cursor, 0, s.duration) &&
      ["A", "B"].includes(s.active) &&
      ["elapsed", "utc"].includes(s.alignment) &&
      ["2d", "3d", "oblique"].includes(s.view) &&
      ["imagery", "elevation", "hillshade", "slope"].includes(s.layer) &&
      [s.grid, s.lighting, s.directions].every((x) => typeof x === "boolean") &&
      Array.isArray(s.satellites) &&
      s.satellites.length <= 12 &&
      s.satellites.every(
        (x) =>
          text(x.id, 100) &&
          (x.ephemeris === undefined || x.ephemeris === "LRO-2022") &&
          text(x.name, 100) &&
          num(x.altitude, 10, 100000) &&
          num(x.inclination, 0, 180) &&
          num(x.raan, 0, 360) &&
          num(x.phase, 0, 360) &&
          /^#[0-9a-f]{6}$/i.test(x.color) &&
          typeof x.visible === "boolean",
      ) &&
      Array.isArray(s.annotations) &&
      s.annotations.length <= 1000 &&
      s.annotations.every(
        (x) =>
          text(x.id, 100) &&
          text(x.name, 100) &&
          text(x.note, 2000) &&
          /^#[0-9a-f]{6}$/i.test(x.color) &&
          ["point", "line", "polygon"].includes(x.kind) &&
          Array.isArray(x.coordinates) &&
          x.coordinates.length >= { point: 1, line: 2, polygon: 3 }[x.kind] &&
          x.coordinates.length <= 2000 &&
          (x.route === undefined || (x.kind === "line" && validRouteMetadata(x.route, x.coordinates.length))) &&
          x.coordinates.every(
            (c) =>
              Array.isArray(c) &&
              c.length === 2 &&
              num(c[0], -180, 180) &&
              num(c[1], -90, 90),
          ),
      ) &&
      Array.isArray(s.events) &&
      s.events.length <= 1000 &&
      s.events.every(
        (x) =>
          text(x.id, 100) &&
          text(x.name, 200) &&
          text(x.notes, 5000) &&
          num(x.offset, 0, s.duration) &&
          num(x.duration, 0, s.duration - x.offset) &&
          ["landing", "ascent", "science", "communication", "traverse", "power"].includes(
            x.type,
          ) &&
          typeof x.done === "boolean" &&
          (x.stopId === undefined || text(x.stopId, 100))
          && (x.stopActivity === undefined || x.stopActivity === "study" || x.stopActivity === "charge"),
      )
    );
  } catch {
    return false;
  }
}
export const activeSite = (s: Study) =>
  s.active === "A" ? s.site : s.compareSite;
export const activeStart = (s: Study) =>
  s.active === "A" ? s.start : s.compareStart;
export const cursorTime = (s: Study) =>
  new Date(
    Date.parse(s.alignment === "elapsed" ? activeStart(s) : s.start) +
      s.cursor * 3600000,
  ).toISOString();
export function rowAt(
  g: Geometry | undefined,
  time: string,
): GeometryRow | null {
  if (!g?.rows.length) return null;
  const t = Date.parse(time);
  const rows = g.rows;
  if (
    t < Date.parse(rows[0].time) ||
    t > Date.parse(rows[rows.length - 1].time)
  )
    return null;
  let index = rows.findIndex((r) => Date.parse(r.time) >= t);
  if (index <= 0) return rows[0];
  const a = rows[index - 1],
    b = rows[index],
    f = (t - Date.parse(a.time)) / (Date.parse(b.time) - Date.parse(a.time));
  const blend = (v: number, w: number) => v + (w - v) * f;
  const body = (key: "sun" | "earth") => ({
    azimuth:
      (a[key].azimuth +
        (((b[key].azimuth - a[key].azimuth + 540) % 360) - 180) * f +
        360) %
      360,
    elevation: blend(a[key].elevation, b[key].elevation),
    radius: blend(a[key].radius, b[key].radius),
    vector: a[key].vector.map((v, i) => blend(v, b[key].vector[i])),
  });
  return {
    time,
    elapsed: blend(a.elapsed, b.elapsed),
    sun: body("sun"),
    earth: body("earth"),
    satellites: Object.fromEntries(
      Object.entries(a.satellites).map(([id, sat]) => {
        const next = b.satellites[id] || sat;
        // Preserve the interpolated orbital radius. A straight chord between distant
        // samples can pass beneath the surface even when both positions are in orbit.
        const chord = sat.position.map((v, i) => blend(v, next.position[i]));
        const chordRadius = Math.hypot(...chord);
        const radius = blend(Math.hypot(...sat.position), Math.hypot(...next.position));
        const position = chordRadius > 1e-9 ? chord.map(v => v * radius / chordRadius) : chord;
        return [
          id,
          {
            ...(f < 0.5 ? sat : next),
            position,
            elevation: blend(sat.elevation, next.elevation),
            above_reference: blend(sat.elevation, next.elevation) > 0,
          },
        ];
      }),
    ),
  };
}
export function totals(g?: Geometry) {
  const r = { sun: 0, earth: 0, overlap: 0 };
  if (!g) return r;
  for (let i = 0; i < g.rows.length - 1; i++) {
    const a = g.rows[i],
      dt = (Date.parse(g.rows[i + 1].time) - Date.parse(a.time)) / 3600000;
    if (a.sun.elevation > 0) r.sun += dt;
    if (a.earth.elevation > 0) r.earth += dt;
    if (a.sun.elevation > 0 && a.earth.elevation > 0) r.overlap += dt;
  }
  return r;
}
export function surfaceDistance(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const x =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 3474.8 * Math.asin(Math.sqrt(Math.min(1, x)));
}
export function geometryKey(s: Study, scenario: "A" | "B") {
  return JSON.stringify({
    lat: (scenario === "A" ? s.site : s.compareSite).lat,
    lon: (scenario === "A" ? s.site : s.compareSite).lon,
    height: (scenario === "A" ? s.site : s.compareSite).height,
    start: scenario === "A" ? s.start : s.compareStart,
    duration: s.duration,
    step: s.step,
    analysis: s.analysis?.enabled ? s.analysis : undefined,
    activities: s.analysis?.enabled
      ? s.events.map(({ id, name, offset, duration, type }) => ({
          id,
          name,
          offset,
          duration,
          type,
        }))
      : undefined,
    satellites: s.satellites.map(
      ({ id, ephemeris, altitude, inclination, raan, phase }) => ({
        ephemeris,
        id,
        altitude,
        inclination,
        raan,
        phase,
      }),
    ),
  });
}

/** Open both current documents and the original cached-fixture prototype exports. */
export function decodeStudy(value: unknown): Study | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const candidate = object.study || value;
  if (isStudy(candidate)) return candidate;
  if (
    object.schema_version === "lunar-window-mvp-v1" &&
    isLegacyProject(object.project)
  ) {
    const old = object.project;
    const s = createStudy("blank");
    const site = { name: "Research observer", lat: -89.5, lon: 0, height: 0 };
    return {
      ...s,
      name: old.name,
      site,
      compareSite: { ...site },
      start: new Date(LEGACY_EPOCH + old.startA * LEGACY_HOUR).toISOString(),
      compareStart: new Date(
        LEGACY_EPOCH + old.startB * LEGACY_HOUR,
      ).toISOString(),
      duration: old.duration,
      cursor: old.cursor,
      active: old.active,
      alignment: old.alignment,
    };
  }
  return null;
}
