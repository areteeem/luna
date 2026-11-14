import { describe, expect, it } from "vitest";
import {
  DEFAULT,
  validProject,
  sample,
  referenceHours,
  selectedHour,
  exportProject,
  csv,
} from "./model";
describe("cached astronomy screening", () => {
  it("preserves actual NASA endpoint values and refuses extrapolation", () => {
    expect(sample("sun", 0)?.elevation_deg).toBe(1.258335);
    expect(sample("earth", 48)?.elevation_deg).toBe(-1.812529);
    expect(sample("sun", 48.01)).toBeNull();
    expect(sample("sun", -1)).toBeNull();
  });
  it("counts half-open hours without adding an endpoint", () => {
    expect(referenceHours("sun", 0, 24)).toBe(24);
    expect(referenceHours("earth", 0, 24)).toBe(0);
  });
  it("keeps the two comparison alignments explicit", () => {
    expect(selectedHour(DEFAULT, "B")).toBe(32);
    expect(selectedHour({ ...DEFAULT, alignment: "utc" }, "B")).toBeNull();
  });
  it("rejects invalid persisted inputs and out-of-coverage intervals", () => {
    expect(validProject(DEFAULT)).toBe(true);
    expect(validProject({ ...DEFAULT, startB: 25 })).toBe(false);
    expect(validProject({ ...DEFAULT, cursor: NaN })).toBe(false);
    expect(validProject({ ...DEFAULT, startA: 0.5 })).toBe(false);
    expect(validProject({})).toBe(false);
  });
  it("exports both scenario endpoints, provenance and explicit limitations", () => {
    const result = exportProject(DEFAULT);
    expect(result.samples.A).toHaveLength(25);
    expect(result.method.terrain_available).toBe(false);
    expect(result.observer.latitude_deg).toBe(-89.5);
    expect(
      csv(DEFAULT)
        .split("\n")
        .filter((r) => r.startsWith("A,") || r.startsWith("B,")),
    ).toHaveLength(100);
  });
});
