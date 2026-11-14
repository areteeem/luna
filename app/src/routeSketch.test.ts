import { describe, expect, it } from "vitest";
import { clearsAvoidAreas } from "./routeAvoidance";
import { sketchRoute } from "./routeSketch";
import type { LunarPoint } from "./surfaceRoutes";

describe("terrain unchecked routes", () => {
  const lander: LunarPoint = [0, 0];
  const stops: LunarPoint[] = [[1, 1], [0, 1], [1, 0]];
  it("finds a shorter loop and respects the entered order when requested", () => {
    const draft = sketchRoute(lander, stops, undefined, true);
    const optimized = sketchRoute(lander, stops, undefined, false);
    const distance = (route: typeof draft) => route.legs.reduce((sum, leg) => sum + leg.distance_m, 0);
    expect(draft.order).toEqual([0, 1, 2, 3, 0]);
    expect(new Set(optimized.order.slice(1, -1))).toEqual(new Set([1, 2, 3]));
    expect(optimized.order.at(-1)).toBe(0);
    expect(distance(optimized)).toBeLessThan(distance(draft));
  });

  it("returns directly across longitude wrap without inventing terrain metrics", () => {
    const route = sketchRoute([179.99, 0], stops, [-179.99, 0], false);
    expect(route.status).toBe("unchecked");
    expect(route.order).toEqual([1, 0]);
    expect(route.legs[0].distance_m).toBeCloseTo(606.47, 1);
    expect(route.legs[0]).toMatchObject({ ascent_m: null, grade_deg: null, spacing_m: null });
  });
});

describe("prohibited areas", () => {
  const box: LunarPoint[] = [[0.004,-0.002],[0.006,-0.002],[0.006,0.002],[0.004,0.002]];

  it("detours in both directions even when elevation is unavailable", () => {
    const route = sketchRoute([0,0],[[0.01,0]],undefined,false,[box]);
    expect(route.status).toBe("unchecked");
    expect(route.legs.every(leg => leg.path.length >= 4 && leg.distance_m > 303)).toBe(true);
    expect(route.legs.every(leg => clearsAvoidAreas(leg.path,[box]))).toBe(true);
    expect(clearsAvoidAreas([[0,0],[0.01,0]],[box])).toBe(false);
  });

  it("returns no line when a required stop is prohibited", () => {
    const route = sketchRoute([0,0],[[0.005,0]],undefined,true,[box]);
    expect(route.status).toBe("avoid-blocked");
    expect(route.legs).toEqual([]);
  });

  it("detours around a date-line polygon", () => {
    const zone: LunarPoint[] = [[179.999,-0.002],[-179.999,-0.002],[-179.999,0.002],[179.999,0.002]];
    const route = sketchRoute([179.99,0],[],[-179.99,0],false,[zone]);
    expect(route.legs[0].path.length).toBeGreaterThan(2);
    expect(clearsAvoidAreas(route.legs[0].path,[zone])).toBe(true);
  });
});
