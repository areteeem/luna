import { describe, expect, it } from "vitest";
import { interpolateSurface, missionFrame, missionRoute, playbackClock, routePlayback } from "./missionPlayback";
import type { Annotation, MissionEvent, Study } from "./study";
import type { LunarPoint, RouteLeg, RouteOverlay } from "./surfaceRoutes";

const lander: LunarPoint = [23.47, 0.67];
const stop: LunarPoint = [23.52, 0.68];
const journey: RouteLeg[] = [
  { start: 0, end: 1, path: [lander, stop], distance_m: 1800, ascent_m: 45, grade_deg: 4, spacing_m: 80, source: "LOLA" },
  { start: 1, end: 0, path: [stop, lander], distance_m: 1800, ascent_m: 15, grade_deg: 4, spacing_m: 80, source: "LOLA" },
];
const proposed: RouteOverlay = {
  studyId: "study", lander, stops: [stop], avoid: [], draft: [], legs: journey,
  playback: { mobility: "rover", speed: 1, stopMinutes: 30, names: ["Lander", "Ridge"] },
};
const event = (type: MissionEvent["type"], offset: number, duration: number): MissionEvent =>
  ({ id: type, name: type, type, offset, duration, notes: "", done: false });
const events = [event("landing", 0, .5), event("traverse", 2, 2), event("ascent", 5, .5)];
const site = { name: "Lander", lat: lander[1], lon: lander[0], height: 0 };
const study = (cursor: number, activities = events): Study => ({
  version: 2, id: "study", name: "Replay", description: "", site, compareSite: site,
  start: "2026-11-17T00:00:00Z", compareStart: "2026-11-18T00:00:00Z",
  duration: 6, cursor, step: 900, active: "A", alignment: "elapsed",
  satellites: [], annotations: [], events: activities,
  view: "3d", layer: "imagery", grid: false, lighting: true, directions: false,
});

describe("mission timeline", () => {
  const route = routePlayback(missionRoute([], [], proposed, null));
  it("includes enabled stop study and charge durations in surface playback", () => {
    const withActivities = routePlayback(missionRoute([], [], proposed, null), [{
      id: "stop-1", point: stop, name: "Ridge", description: "",
      studyActivity: { enabled: true, duration: 60 },
      chargeActivity: { enabled: true, duration: 30 },
    }]);
    expect(withActivities?.totalHours).toBeCloseTo(3);
  });

  it("moves along the proposed legs, dwells at the stop and holds at the lander", () => {
    expect(missionFrame(study(1.9), route).rover).toBeUndefined();
    const outbound = missionFrame(study(2.25), route).rover;
    expect(outbound?.point).not.toEqual(lander);
    expect(outbound?.distance).toBeCloseTo(900);
    expect(outbound?.ascent).toBeCloseTo(22.5);
    expect(missionFrame(study(2.75), route).rover).toMatchObject({ point: stop, stage: "Ridge", distance: 1800 });
    expect(missionFrame(study(3.25), route).rover).toMatchObject({ stage: "To Lander", distance: 2700 });
    expect(missionFrame(study(4), route).rover).toMatchObject({ point: lander, stage: "Back at lander", ascent: 60 });
  });

  it("derives flight altitude from the cursor and returns the same pose when scrubbing", () => {
    expect(missionFrame(study(0), route).flight).toMatchObject({ stage: "Descent", altitude: 12000 });
    expect(missionFrame(study(.5), route).flight).toMatchObject({ stage: "Landed", altitude: 0 });
    const climbing = missionFrame(study(5.25), route).flight;
    expect(climbing?.stage).toBe("Ascent");
    expect(climbing?.altitude).toBeGreaterThan(0);
    expect(missionFrame(study(6), route).flight).toBeUndefined();
    expect(missionFrame(study(5.25), route).flight).toEqual(climbing);
  });

  it("gives short flights time on screen while preserving their mission times", () => {
    const clock = playbackClock(24, [event("landing", 0, .5), event("ascent", 13, .5)], 16);
    expect(clock.secondsAt(.5)).toBeCloseTo(1.92);
    expect(clock.secondsAt(24)).toBeLessThan(20);
    for (const cursor of [0, .2, .5, 7, 13, 13.25, 24]) {
      expect(clock.cursorAt(clock.secondsAt(cursor))).toBeCloseTo(cursor);
    }
  });

  it("uses the short crossing at the antimeridian", () => {
    const point = interpolateSurface([179, 0], [-179, 0], .5);
    expect(Math.abs(point[0])).toBeCloseTo(180);
    expect(point[1]).toBeCloseTo(0);
  });

  it("replays saved leg boundaries and skips a route invalidated by a new keep-out region", () => {
    const annotation: Annotation = {
      id: "loop", kind: "line", name: "Loop", note: "", color: "#7fdcff", coordinates: [lander, stop, lander],
      route: { lander, stops: [stop], mobility: "rover", speed: 1, stopMinutes: 0, maxGrade: 12,
        order: [0, 1, 0], legs: journey, legEnds: [1, 2], avoid: [] },
    };
    const selected = missionRoute([annotation], [], null, "loop");
    expect(selected?.legs[1].path).toEqual([stop, lander]);
    expect(missionRoute([annotation], [[[23.48, .65], [23.5, .65], [23.5, .7], [23.48, .7]]], null, "loop")).toBeNull();
  });
});
