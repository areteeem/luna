import { clearsAvoidAreas } from "./routeAvoidance";
import { activeSite, surfaceDistance } from "./study";
import type { Annotation, MissionEvent, Study } from "./study";
import type { LunarPoint, Mobility, RouteLeg, RouteOverlay } from "./surfaceRoutes";

export const PLAYBACK_SECONDS = { fast: 16, normal: 45, slow: 120 } as const;

function savedLegs(annotation: Annotation): RouteLeg[] {
  const route = annotation.route!;
  return route.legs.map((leg, i) => ({
    ...leg,
    path: annotation.coordinates.slice(i ? route.legEnds[i - 1] : 0, route.legEnds[i] + 1),
  }));
}

export function missionRoute(annotations: Study["annotations"], avoid: Study["prohibitedAreas"], overlay: RouteOverlay | null, selectedId: string | null) {
  const saved = annotations.filter(annotation => annotation.route &&
    clearsAvoidAreas(annotation.coordinates, [...annotation.route.avoid, ...(avoid ?? [])]));
  const selected = saved.find(annotation => annotation.id === selectedId);
  if (!selected && overlay?.playback && overlay.legs.length) {
    return { ...overlay.playback, legs: overlay.legs };
  }
  const annotation = selected ?? saved.find(item => item.route?.order[0] === 0) ?? saved[0];
  if (!annotation?.route) return null;
  const route = annotation.route;
  return {
    mobility: route.mobility,
    speed: route.speed,
    stopMinutes: route.stopMinutes,
    names: ["Lander", ...route.stops.map((_, i) => route.stopDetails?.[i]?.name || `Stop ${i + 1}`)],
    legs: savedLegs(annotation),
  };
}

export function interpolateSurface(a: LunarPoint, b: LunarPoint, fraction: number): LunarPoint {
  if (fraction <= 0) return a;
  if (fraction >= 1) return b;
  const rad = Math.PI / 180;
  const av = [Math.cos(a[1] * rad) * Math.cos(a[0] * rad), Math.cos(a[1] * rad) * Math.sin(a[0] * rad), Math.sin(a[1] * rad)];
  const bv = [Math.cos(b[1] * rad) * Math.cos(b[0] * rad), Math.cos(b[1] * rad) * Math.sin(b[0] * rad), Math.sin(b[1] * rad)];
  const angle = surfaceDistance(a, b) / 1737.4;
  const sin = Math.sin(angle);
  if (angle < 1e-9) return a;
  if (Math.abs(sin) < 1e-9) {
    const lon = a[0] + (((b[0] - a[0] + 540) % 360) - 180) * fraction;
    return [((lon + 540) % 360) - 180, a[1] + (b[1] - a[1]) * fraction];
  }
  const left = Math.sin((1 - fraction) * angle) / sin;
  const right = Math.sin(fraction * angle) / sin;
  const [x, y, z] = av.map((coordinate, axis) => left * coordinate + right * bv[axis]);
  return [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
}

function legPath(leg: RouteLeg) {
  const distances = [0];
  for (let i = 1; i < leg.path.length; i++) {
    distances.push(distances[i - 1] + surfaceDistance(leg.path[i - 1], leg.path[i]));
  }
  return { distances, path: leg.path };
}

function positionAlong({ distances, path }: ReturnType<typeof legPath>, fraction: number) {
  if (path.length < 2 || fraction <= 0) return path[0];
  if (fraction >= 1) return path.at(-1)!;
  const target = fraction * distances.at(-1)!;
  const next = distances.findIndex(distance => distance > target);
  if (next < 1) return path.at(-1)!;
  return interpolateSurface(path[next - 1], path[next], (target - distances[next - 1]) / (distances[next] - distances[next - 1]));
}

export function routePlayback(route: ReturnType<typeof missionRoute>) {
  if (!route || route.speed <= 0 || !route.legs.every(leg => leg.path.length >= 2)) return null;
  const stops = route.legs.filter(leg => leg.end !== 0).length;
  let totalHours = 0;
  const legs = route.legs.map(leg => {
    const start = totalHours;
    const travelHours = leg.distance_m / route.speed / 3600;
    const dwellHours = stops && leg.end !== 0 ? route.stopMinutes / stops / 60 : 0;
    totalHours += travelHours + dwellHours;
    return { leg, start, travelHours, end: totalHours, path: legPath(leg) };
  });
  return totalHours > 0 && Number.isFinite(totalHours) ? { totalHours, legs, mobility: route.mobility, names: route.names } : null;
}

type SurfaceFrame = { point: LunarPoint; mobility: Mobility; stage: string; distance: number; ascent: number | null };
type FlightFrame = { point: LunarPoint; stage: "Descent" | "Landed" | "Ascent" | "Departed"; altitude: number };
type MissionFrame = { activity?: MissionEvent; rover?: SurfaceFrame; flight?: FlightFrame; estimatedTraverse: boolean };

export function missionFrame(study: Study, route: ReturnType<typeof routePlayback>): MissionFrame {
  const { cursor, events } = study;
  const activity = events.find(event => cursor >= event.offset && cursor < event.offset + event.duration);
  const landing = events.reduce<MissionEvent | undefined>((first, event) =>
    event.type === "landing" && (!first || event.offset < first.offset) ? event : first, undefined);
  const flightEvent = events.reduce<MissionEvent | undefined>((latest, event) =>
    (event.type === "landing" || event.type === "ascent") && event.offset <= cursor &&
    (!latest || event.offset >= latest.offset) ? event : latest, undefined);
  const traverse = events.filter(event => event.type === "traverse").sort((a, b) => a.offset - b.offset)[0];
  const routeStart = traverse?.offset ?? (landing ? landing.offset + landing.duration : 0);
  const site = activeSite(study);
  const point: LunarPoint = [site.lon, site.lat];
  const frame: MissionFrame = { activity, estimatedTraverse: Boolean(route && !traverse) };
  if (flightEvent) {
    const fraction = flightEvent.duration ? Math.min(1, (cursor - flightEvent.offset) / flightEvent.duration) : 1;
    if (flightEvent.type === "landing") {
      frame.flight = { point, stage: fraction < 1 ? "Descent" : "Landed", altitude: 12000 * (1 - fraction) ** 1.6 };
    } else if (fraction < 1 || cursor === flightEvent.offset + flightEvent.duration) {
      frame.flight = { point, stage: fraction < 1 ? "Ascent" : "Departed", altitude: 12000 * fraction ** 1.6 };
    }
  }
  if (!route || cursor < routeStart || (traverse && traverse.duration === 0) || frame.flight?.stage === "Descent") return frame;
  const schedule = Math.min(route.totalHours, traverse?.duration ?? route.totalHours, study.duration - routeStart);
  if (schedule <= 0) return frame;
  const elapsed = Math.min(route.totalHours, (cursor - routeStart) / schedule * route.totalHours);
  let distance = 0;
  let ascentMeters: number | null = 0;
  for (const { leg, start, travelHours, end, path } of route.legs) {
    const progress = travelHours ? Math.min(1, (elapsed - start) / travelHours) : 1;
    distance += leg.distance_m * progress;
    ascentMeters = ascentMeters === null || leg.ascent_m === null ? null : ascentMeters + leg.ascent_m * progress;
    if (elapsed <= end) {
      const destination = route.names[leg.end] ?? `Stop ${leg.end}`;
      const atStop = progress >= 1;
      frame.rover = {
        point: positionAlong(path, progress), mobility: route.mobility, distance, ascent: ascentMeters,
        stage: atStop ? (leg.end === 0 ? "Back at lander" : destination) : `To ${destination}`,
      };
      break;
    }
  }
  return frame;
}

export function playbackClock(duration: number, events: Study["events"], targetSeconds: number) {
  const flight = events.filter(event => (event.type === "landing" || event.type === "ascent") && event.duration > 0);
  const boundaries = [...new Set([0, duration, ...flight.flatMap(event => [event.offset, event.offset + event.duration])])].sort((a, b) => a - b);
  let elapsed = 0;
  const segments = boundaries.slice(1).map((end, i) => {
    const start = boundaries[i];
    const event = flight.find(item => start >= item.offset && end <= item.offset + item.duration);
    const seconds = Math.max((end - start) / duration * targetSeconds,
      event ? (end - start) / event.duration * targetSeconds * .12 : 0);
    const segment = { start, end, seconds, elapsed };
    elapsed += seconds;
    return segment;
  });
  return {
    secondsAt(cursor: number) {
      const segment = segments.find(item => cursor < item.end);
      return segment ? segment.elapsed + (cursor - segment.start) / (segment.end - segment.start) * segment.seconds : elapsed;
    },
    cursorAt(seconds: number) {
      const segment = segments.find(item => seconds < item.elapsed + item.seconds);
      return segment ? segment.start + (seconds - segment.elapsed) / segment.seconds * (segment.end - segment.start) : duration;
    },
  };
}
