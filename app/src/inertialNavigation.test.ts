import { describe, expect, it } from "vitest";
import { destination, parseSample, routeProgress, Tracker } from "./inertialNavigation";
import type { Sample, TrackingConfig } from "./inertialNavigation";
import { surfaceDistance } from "./study";

const config: TrackingConfig = {
  anchor:[179.9999,0], heading:90, mobility:"rover", gravity:1.62, stepLength:0.7,
  threshold:0.3, interval:300,
};
const stationary = (fields: Partial<Sample> = {}) =>
  Array.from({length:41},(_,i): Sample => ({ t_ms:i*50, accel:[0,0,1.62], ...fields }));
const meters = (tracker: Tracker) => surfaceDistance(config.anchor,tracker.position)*1000;

describe("external inertial navigation", () => {
  it("validates the protocol and ignores magnetic fields", () => {
    expect(parseSample('{"v":1,"t_ms":10,"accel":[0,0,1.62],"mag":[9,10,12]}'))
      .toEqual({t_ms:10,accel:[0,0,1.62]});
    expect(parseSample('{"v":2,"t_ms":10,"accel":[0,0,1.62]}')).toBeNull();
    expect(parseSample('{"v":1,"t_ms":10,"accel":[0,0,"1.62"]}')).toBeNull();
  });

  it("holds position on a stationary slope and rejects the wrong gravity", () => {
    const tilted = [0.81,0,Math.sqrt(1.62**2-0.81**2)] as Sample["accel"];
    const tracker = new Tracker(config,stationary({accel:tilted,gyro:[0,0,0]}));
    tracker.ingest({t_ms:2300,accel:tilted,gyro:[0,0,0]});
    expect(meters(tracker)).toBeLessThan(1e-6);
    expect(() => new Tracker(config,stationary({accel:[0,0,9.81]}))).toThrow(/gravity/);
  });

  it("uses wheel distance and pauses after a reset or device gap", () => {
    const tracker = new Tracker(config,stationary({gyro:[0,0,0],wheel_m:0}));
    tracker.ingest({t_ms:2100,accel:[0,0,1.62],gyro:[0,0,0],wheel_m:5});
    expect(meters(tracker)).toBeCloseTo(5);
    expect(tracker.position[0]).toBeLessThan(0);
    tracker.ingest({t_ms:2150,accel:[0,0,1.62],gyro:[0,0,0],wheel_m:0});
    expect(tracker.issue).toMatch(/reset/);
    expect(meters(tracker)).toBeCloseTo(5);
    const gap = new Tracker(config,stationary({gyro:[0,0,0],wheel_m:0}));
    gap.ingest({t_ms:3000,accel:[0,0,1.62],gyro:[0,0,0],wheel_m:12});
    expect(gap.issue).toMatch(/gap/);
    expect(meters(gap)).toBe(0);
  });

  it("integrates acceleration then freezes after five seconds", () => {
    const tracker = new Tracker(config,stationary({gyro:[0,0,0]}));
    for (let t=2050;t<=7050;t+=50) tracker.ingest({t_ms:t,accel:[0.4,0,1.62],gyro:[0,0,0]});
    expect(meters(tracker)).toBeCloseTo(4.95,1);
    expect(tracker.issue).toMatch(/Five-second/);
  });

  it("counts rising edges and supports walking heading changes", () => {
    const tracker = new Tracker({...config,mobility:"walking",heading:0},stationary());
    tracker.ingest({t_ms:2050,accel:[0,0,2.2]});
    tracker.ingest({t_ms:2100,accel:[0,0,2.2]});
    tracker.ingest({t_ms:2200,accel:[0,0,1.62]});
    tracker.setHeading(90);
    tracker.ingest({t_ms:2400,accel:[0,0,2.2]});
    tracker.ingest({t_ms:2300,accel:[0,0,1.62]});
    expect(tracker.steps).toBe(2);
    expect(meters(tracker)).toBeCloseTo(Math.hypot(0.7,0.7));
  });

  it("keeps the active leg at crossings and reports off-route distance", () => {
    const start = config.anchor;
    const east = destination(start,20,0);
    const north = destination(start,0,20);
    const path = [start,east,north,start];
    expect(routeProgress(path,start,0,3)?.leg).toBe(0);
    expect(routeProgress(path,destination(start,8,5),0,3)?.crossTrack).toBeCloseTo(5);
  });
});
