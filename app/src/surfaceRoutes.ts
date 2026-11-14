
export type LunarPoint = [number, number];
export type Mobility = "rover" | "walking";
export type RouteLeg = {
  start: number;
  end: number;
  path: LunarPoint[];
  distance_m: number;
  ascent_m: number | null;
  grade_deg: number | null;
  source: string;
  spacing_m: number | null;
};
export type RouteResult = { status: string; order: number[]; legs: RouteLeg[] };
export type RouteMetadata = {
  lander: LunarPoint;
  stops: LunarPoint[];
  stopDetails?: { name: string; description: string }[];
  mobility: Mobility;
  speed: number;
  stopMinutes: number;
  maxGrade: number;
  order: number[];
  legs: Omit<RouteLeg, "path">[];
  legEnds: number[];
  avoid: LunarPoint[][];
};
export type RouteOverlay = {
  studyId: string;
  lander: LunarPoint;
  stops: LunarPoint[];
  origin?: LunarPoint;
  avoid: LunarPoint[][];
  draft: LunarPoint[];
  track?: LunarPoint[];
  legs: RouteLeg[];
  playback?: { mobility: Mobility; speed: number; stopMinutes: number; names: string[] };
};

export function bearing(from: LunarPoint, to: LunarPoint) {
  const rad = Math.PI / 180;
  const a = from[1] * rad;
  const b = to[1] * rad;
  const lon = (to[0] - from[0]) * rad;
  return (Math.atan2(Math.sin(lon) * Math.cos(b),
    Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(lon)) / rad + 360) % 360;
}

export function travelTime(meters: number, speed: number, stopMinutes = 0) {
  if (!(speed > 0) || !Number.isFinite(speed)) return "Enter a positive pace";
  const seconds = Math.round(meters / speed + stopMinutes * 60);
  if (!Number.isSafeInteger(seconds)) return "Travel time out of range";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function validRouteMetadata(value: unknown, count: number): value is RouteMetadata {
  if (!value || typeof value !== "object") return false;
  const route = value as RouteMetadata;
  const inRange = (input: unknown, min: number, max: number): input is number =>
    typeof input === "number" && Number.isFinite(input) && input >= min && input <= max;
  const isPoint = (input: unknown): input is LunarPoint =>
    Array.isArray(input) && input.length === 2 && inRange(input[0], -180, 180) && inRange(input[1], -90, 90);
  if (!isPoint(route.lander) || !Array.isArray(route.stops) || !route.stops.length
    || (route.stopDetails !== undefined && (!Array.isArray(route.stopDetails)
      || route.stopDetails.length !== route.stops.length || !route.stopDetails.every(stop =>
        stop && typeof stop.name === "string" && stop.name.length <= 100
        && typeof stop.description === "string" && stop.description.length <= 2000)))
    || route.stops.length > 6 || !route.stops.every(isPoint)
    || (route.mobility !== "rover" && route.mobility !== "walking")
    || !inRange(route.speed, 0, Number.MAX_VALUE) || !inRange(route.stopMinutes, 0, Number.MAX_VALUE)
    || !inRange(route.maxGrade, 1, 35) || !Array.isArray(route.avoid) || route.avoid.length > 8
    || !route.avoid.every((polygon) => Array.isArray(polygon) && polygon.length >= 3 && polygon.length <= 32 && polygon.every(isPoint))
    || !Array.isArray(route.order) || route.order.at(-1) !== 0
    || !Array.isArray(route.legs) || !Array.isArray(route.legEnds)
    || route.legs.length !== route.order.length - 1 || route.legEnds.length !== route.legs.length
    || route.legEnds.at(-1) !== count - 1) return false;
  const outbound = route.order.slice(0, -1);
  if (outbound[0] === 0) {
    if (outbound.length !== route.stops.length + 1 || new Set(outbound).size !== outbound.length
      || !outbound.every((index) => Number.isInteger(index) && inRange(index, 0, route.stops.length))) return false;
  } else if (outbound.length !== 1 || outbound[0] !== 1 || route.stops.length !== 1) return false;
  return route.legs.every((leg, i) => leg && leg.start === route.order[i] && leg.end === route.order[i + 1]
    && inRange(leg.distance_m, 0, Number.MAX_VALUE) && inRange(leg.ascent_m, 0, Number.MAX_VALUE)
    && inRange(leg.grade_deg, 0, 90) && inRange(leg.spacing_m, 0.01, 10000)
    && typeof leg.source === "string" && leg.source.length <= 100
    && Number.isInteger(route.legEnds[i]) && route.legEnds[i] > (route.legEnds[i - 1] ?? 0));
}
