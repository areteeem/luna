import type { Study, Geometry, MissionEvent } from "./study";
import { uid } from "./study";
export function moveActivity(
  s: Study,
  id: string,
  offset: number,
): MissionEvent[] {
  return s.events.map((e) =>
    e.id === id
      ? {
          ...e,
          offset: Math.max(
            0,
            Math.min(s.duration - e.duration, Math.round(offset * 60) / 60),
          ),
        }
      : e,
  );
}
export function reorderActivities(
  s: Study,
  from: string,
  to: string,
): MissionEvent[] | null {
  const events = [...s.events].sort((a, b) => a.offset - b.offset);
  const source = events.find((e) => e.id === from),
    target = events.findIndex((e) => e.id === to);
  if (!source || target < 0) return null;
  const ordered = events.filter((e) => e.id !== from);
  ordered.splice(target, 0, source);
  if (ordered.reduce((n, e) => n + e.duration, 0) > s.duration) return null;
  let offset = 0;
  return ordered.map((e) => {
    const next = { ...e, offset };
    offset += e.duration;
    return next;
  });
}
export function recommendPlan(
  s: Study,
  g?: Geometry,
): { events: MissionEvent[]; reasons: string[] } {
  const analysis = g?.analysis;
  if (!analysis)
    return {
      events: [],
      reasons: [
        "Enable mission analysis and wait for calculation before recommending a plan.",
      ],
    };
  const reasons: string[] = [];
  const events: MissionEvent[] = [];
  const create = (
    name: string,
    offset: number,
    duration: number,
    type: MissionEvent["type"],
    notes: string,
  ) => ({
    id: uid(),
    name,
    offset,
    duration: Math.min(duration, s.duration - offset),
    type,
    notes,
    done: false,
  });
  const rows = analysis.rows,
    span = Math.min(0.5, s.duration / 4);
  const viable = rows.filter(
    (r) =>
      r.elapsed + span <= s.duration &&
      !r.terrain_unknown &&
      r.solar_fraction_lower > 0.5 &&
      r.soc_conservative >= analysis.inputs.minimum_soc,
  );
  const best = [...viable].sort(
    (a, b) =>
      b.solar_fraction_lower +
      b.soc_conservative -
      (a.solar_fraction_lower + a.soc_conservative),
  )[0];
  if (best) {
    events.push(
      create(
        "Surface science candidate",
        best.elapsed,
        span,
        "science",
        "Selected by known terrain visibility and sampled solar/SOC ranking. Recalculate power after applying; this task adds load.",
      ),
    );
    reasons.push(
      "Science block starts at a known-visibility sample with high solar input and battery reserve.",
    );
  } else
    reasons.push(
      "No science window established with known terrain, sunlight and conservative reserve.",
    );
  const contact = rows.find(
    (r) =>
      r.elapsed + span <= s.duration &&
      r.station.access === true &&
      r.station.rf.nominal_margin_db >= 0 &&
      rows
        .filter((x) => x.elapsed >= r.elapsed && x.elapsed <= r.elapsed + span)
        .every(
          (x) =>
            x.station.access === true && x.station.rf.nominal_margin_db >= 0,
        ),
  );
  if (contact) {
    events.push(
      create(
        "Downlink candidate",
        contact.elapsed,
        span,
        "communication",
        "Sampled station access and RF margin; continuity between samples and DSN booking require review.",
      ),
    );
    reasons.push(
      "Downlink block checks available samples across the interval.",
    );
  } else
    reasons.push(
      "No sampled contact interval meets both station access and nominal RF margin.",
    );
  reasons.push(
    "These are sampled single-block suggestions, not a jointly optimized schedule. Applying them adds activities; recalculate battery and review overlaps.",
  );
  return { events, reasons };
}
