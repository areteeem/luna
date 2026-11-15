import { describe, expect, it } from "vitest";
import { createStudy, isStudy } from "./study";
import { syncStopActivityEvents, updateStopActivity } from "./missionActivities";

describe("stop mission activities", () => {
  it("keeps older stops valid and creates location-linked activity events", () => {
    const study = createStudy("blank");
    const point: [number, number] = [study.site.lon + 0.001, study.site.lat];
    study.missionStops = [{ id: "s1", point, name: "Ridge", description: "Inspect rocks" }];
    expect(isStudy(study)).toBe(true);

    study.missionStops[0].studyActivity = { enabled: true, duration: 30 };
    const events = syncStopActivityEvents(study);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "science", stopId: "s1", stopActivity: "study", duration: 0.5 });
    expect(events[0].name).toContain("Ridge");
  });

  it("places activities in stop order and retains manual timing when the route changes", () => {
    const study = createStudy("blank");
    study.site = { ...study.site, lon: 0, lat: 0 };
    study.missionStops = [
      { id: "s1", point: [0.01, 0], name: "Alpha", description: "", studyActivity: { enabled: true, duration: 20 } },
      { id: "s2", point: [0.02, 0], name: "Beta", description: "", chargeActivity: { enabled: true, duration: 40 } },
    ];
    const first = syncStopActivityEvents(study);
    expect(first[0].offset).toBeGreaterThan(0);
    expect(first[1].offset).toBeGreaterThan(first[0].offset + first[0].duration);

    const edited = updateStopActivity({ ...study, events: first }, "s1", "study", { offset: 5 });
    const reordered = { ...study, missionStops: [...edited.missionStops].reverse(), events: edited.events };
    const afterRouteChange = syncStopActivityEvents(reordered);
    expect(afterRouteChange.find(event => event.stopId === "s1")?.offset).toBe(5);
    expect(afterRouteChange.find(event => event.stopId === "s2")?.offset).not.toBe(first[1].offset);
  });

  it("removes generated events when an activity is disabled", () => {
    const study = createStudy("blank");
    study.missionStops = [{ id: "s1", point: [0.1, 0], name: "Ridge", description: "", chargeActivity: { enabled: true, duration: 10 } }];
    const withCharge = syncStopActivityEvents(study);
    const disabled = updateStopActivity({ ...study, events: withCharge }, "s1", "charge", { enabled: false });
    expect(disabled.events).toEqual([]);
  });
});
