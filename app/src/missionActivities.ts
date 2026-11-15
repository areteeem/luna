import { activeSite, surfaceDistance } from "./study";
import type { MissionEvent, MissionStopActivity, Study } from "./study";

type StopActivityKind = "study" | "charge";

function routeFor(study: Study) {
  return study.annotations.filter(annotation => annotation.route?.order[0] === 0).at(-1)?.route;
}

function itinerary(study: Study) {
  const stops = study.missionStops ?? [];
  const route = routeFor(study);
  if (route && route.stops.length === stops.length) {
    return {
      order: route.order.filter(index => index > 0 && index <= stops.length).map(index => index - 1),
      speed: route.speed,
      route,
    };
  }
  return { order: stops.map((_, index) => index), speed: 1, route: undefined };
}

function defaultActivityOffsets(study: Study) {
  const stops = study.missionStops ?? [];
  const { order, speed, route } = itinerary(study);
  const site = activeSite(study);
  let previous = route?.lander ?? [site.lon, site.lat] as [number, number];
  const traverse = study.events.filter(event => event.type === "traverse").sort((a, b) => a.offset - b.offset)[0];
  const landingEnd = study.events
    .filter(event => event.type === "landing")
    .reduce((end, event) => Math.max(end, event.offset + event.duration), 0);
  let elapsed = traverse?.offset ?? landingEnd;
  const offsets = new Map<string, number>();
  const baseDwell = route && order.length ? route.stopMinutes / order.length / 60 : 0;

  for (const stopIndex of order) {
    const stop = stops[stopIndex];
    if (!stop) continue;
    const routeLeg = route?.legs.find(leg => leg.end === stopIndex + 1);
    const distance = routeLeg?.distance_m ?? surfaceDistance(previous, stop.point) * 1000;
    if (speed > 0 && Number.isFinite(distance)) elapsed += distance / speed / 3600;
    elapsed += baseDwell;
    previous = stop.point;
    for (const [kind, activity] of [["study", stop.studyActivity], ["charge", stop.chargeActivity]] as const) {
      if (activity?.enabled) {
        offsets.set(`${stop.id}:${kind}`, elapsed);
        elapsed += activity.duration / 60;
      }
    }
  }
  return offsets;
}

function eventFor(
  stop: NonNullable<Study["missionStops"]>[number],
  kind: StopActivityKind,
  config: MissionStopActivity,
  offset: number,
  duration: number,
  previous?: MissionEvent,
): MissionEvent | undefined {
  const remaining = duration - offset;
  if (!(remaining > 0)) return undefined;
  const title = stop.name.trim() || "Stop";
  return {
    id: previous?.id ?? `stop-activity-${stop.id}-${kind}`,
    name: `${title} · ${kind === "study" ? "Science study" : "Recharge"}`,
    offset,
    duration: Math.min(config.duration / 60, remaining),
    type: kind === "study" ? "science" : "power",
    notes: stop.description,
    done: previous?.done ?? false,
    stopId: stop.id,
    stopActivity: kind,
  };
}

/** Keep stop activities represented as ordinary mission events for playback and analysis. */
export function syncStopActivityEvents(study: Study): Study["events"] {
  const stops = study.missionStops ?? [];
  const existing = new Map(
    study.events.filter(event => event.stopId && event.stopActivity)
      .map(event => [`${event.stopId}:${event.stopActivity}`, event]),
  );
  const offsets = defaultActivityOffsets(study);
  const generated: MissionEvent[] = [];

  for (const stop of stops) {
    for (const kind of ["study", "charge"] as const) {
      const config = kind === "study" ? stop.studyActivity : stop.chargeActivity;
      if (!config?.enabled) continue;
      const key = `${stop.id}:${kind}`;
      const event = eventFor(stop, kind, config, config.offset ?? offsets.get(key) ?? 0, study.duration, existing.get(key));
      if (event) generated.push(event);
    }
  }
  return [...study.events.filter(event => !(event.stopId && event.stopActivity)), ...generated];
}

export function updateStopActivity(
  study: Study,
  stopId: string,
  kind: StopActivityKind,
  patch: Partial<MissionStopActivity>,
) {
  const missionStops = (study.missionStops ?? []).map(stop => {
    if (stop.id !== stopId) return stop;
    const key = kind === "study" ? "studyActivity" : "chargeActivity";
    return { ...stop, [key]: { enabled: false, duration: 60, ...stop[key], ...patch } };
  });
  const next = { ...study, missionStops };
  return { missionStops, events: syncStopActivityEvents(next) };
}
