import { describe, it, expect } from "vitest";
import { SCIENCE_DEFAULTS, validScience } from "./science";
import { NASA_EXAMPLES, nasaExample } from "./examples";
import { geometryKey, isStudy, decodeStudy } from "./study";
import { studyJSON } from "./exports";
describe("research model documents", () => {
  it("loads valid NASA examples and preserves their sources through export", () => {
    for (const e of NASA_EXAMPLES) {
      const s = nasaExample(e.id);
      expect(isStudy(s)).toBe(true);
      expect(decodeStudy(JSON.parse(studyJSON(s)))?.analysis).toEqual(
        s.analysis,
      );
    }
    expect(nasaExample("eclipse2022").satellites[0].ephemeris).toBe("LRO-2022");
    expect(nasaExample("apollo17").start).toBe("1972-12-11T19:54:57Z");
  });
  it("rejects invalid hardware and unknown ephemeris imports", () => {
    expect(validScience({ ...SCIENCE_DEFAULTS, panel_efficiency: 2 })).toBe(
      false,
    );
    expect(
      validScience({ ...SCIENCE_DEFAULTS, initial_soc: 0.1, minimum_soc: 0.9 }),
    ).toBe(false);
    const s = nasaExample("eclipse2022");
    expect(
      isStudy({
        ...s,
        satellites: [{ ...s.satellites[0], ephemeris: "invented" }],
      }),
    ).toBe(false);
  });
  it("invalidates physics cache for hardware, activity and trajectory changes", () => {
    const s = nasaExample("eclipse2022"),
      key = geometryKey(s, "A");
    expect(
      geometryKey({ ...s, analysis: { ...s.analysis!, tx_power_w: 99 } }, "A"),
    ).not.toBe(key);
    expect(
      geometryKey(
        { ...s, events: s.events.map((e) => ({ ...e, offset: 1 })) },
        "A",
      ),
    ).not.toBe(key);
    expect(
      geometryKey(
        {
          ...s,
          satellites: s.satellites.map((e) => ({ ...e, ephemeris: undefined })),
        },
        "A",
      ),
    ).not.toBe(key);
    expect(geometryKey({ ...s, cursor: 5 }, "A")).toBe(key);
  });
});
