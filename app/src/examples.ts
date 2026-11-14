import { createStudy, uid, newSatellite } from "./study";
import type { Study } from "./study";
import { SCIENCE_DEFAULTS } from "./science";
export const NASA_EXAMPLES = [
  {
    id: "apollo17",
    name: "Apollo 17 · historical surface conditions",
    kind: "Historical reconstruction",
    purpose:
      "Inspect solar geometry and individual DSN-site visibility around the documented Taurus-Littrow landing. Compare activity windows; hardware and battery values remain illustrative.",
    source: "https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo17info.html",
  },
  {
    id: "eclipse2022",
    name: "LRO 2022 eclipse · definitive trajectory",
    kind: "NASA event regression example",
    purpose:
      "Track LRO using NASA definitive SPK positions during the 8 November 2022 eclipse. Inspect spacecraft Earth/Moon shadows alongside a separate hypothetical surface battery study.",
    source: "https://eclipse.gsfc.nasa.gov/OH/OH2022.html",
  },
  {
    id: "polar",
    name: "LOLA Site04 · rover terrain / power trade-off",
    kind: "NASA-data engineering exercise",
    purpose:
      "Screen a real NASA terrain study point for sampled horizon blockage, slope, direct-to-Earth opportunities and battery reserve. Compare candidate science windows with explicit unknowns. Not the VIPER landing site or a flown traverse.",
    source: "https://pgda.gsfc.nasa.gov/products/78",
  },
];
export function nasaExample(id: string): Study {
  const s = createStudy("blank");
  s.analysis = { ...SCIENCE_DEFAULTS, enabled: true };
  s.duration = 24;
  s.step = 600;
  s.cursor = 1;
  if (id === "apollo17") {
    s.name = "Apollo 17 historical conditions";
    s.site = {
      name: "Taurus-Littrow (NASA rounded coordinates)",
      lat: 20.19,
      lon: 30.77,
      height: 0,
    };
    s.start = "1972-12-11T19:54:57Z";
    s.duration = 75;
    s.step = 900;
    s.analysis.terrain = false;
    s.description =
      "Historical landing time and rounded coordinates from NASA NSSDCA. NASA timeline lists engine cutoff one second later. Activity timings below are based on published events; hardware, modern DSN station modeling and power assumptions are illustrative, not Apollo flight reconstruction. No claim of improving the historical mission.";
    s.events = [
      {
        id: uid(),
        name: "Lunar landing (NASA summary)",
        offset: 0,
        duration: 0,
        type: "landing",
        notes:
          "NASA NSSDCA: 19:54:57 UTC. Timeline engine cutoff is 19:54:58 UTC.",
        done: false,
      },
      {
        id: uid(),
        name: "EVA 1 start (published)",
        offset: (4 * 3600 - 8) / 3600,
        duration: 1,
        type: "science",
        notes:
          "Published start: 1972-12-11 23:54:49 UTC. One-hour duration is an illustrative analysis block, not the historical EVA duration.",
        done: false,
      },
      {
        id: uid(),
        name: "ALSEP offload (published)",
        offset: (5 * 3600 + 36 * 60 + 33) / 3600,
        duration: 0.5,
        type: "science",
        notes:
          "Published event: 1972-12-12 01:31:30 UTC; duration illustrative.",
        done: false,
      },
    ];
  } else if (id === "eclipse2022") {
    s.name = "LRO definitive trajectory · 2022 eclipse";
    s.satellites = [
      {
        ...newSatellite(0),
        name: "LRO · NASA definitive SPK",
        ephemeris: "LRO-2022",
        color: "#6ee7ff",
      },
    ];
    s.site = { name: "Near-side eclipse observer", lat: 0, lon: 0, height: 0 };
    s.start = "2022-11-08T08:00:00Z";
    s.duration = 7;
    s.step = 300;
    s.cursor = 3;
    s.analysis.terrain = false;
    s.analysis.panel_area_m2 = 1;
    s.analysis.battery_wh = 400;
    s.analysis.base_load_w = 90;
    s.analysis.active_load_w = 50;
    s.description =
      "LRO positions use the FDF/GSFC ACTUAL definitive SPK (2022-09-15 through 2022-12-15); spacecraft shadow fractions use spherical Earth/Moon masks. The power simulation is a separate surface exercise, not an LRO energy reconstruction. NASA cataloged total lunar eclipse on 2022-11-08. Surface observer at 0°,0° is a research input. Spherical Earth/uniform Sun exclude atmospheric shadow enlargement and refracted red light. Battery and array are not LRO hardware. The example illustrates an eclipse power-review task, not an optimized NASA flight plan.";
    s.events = [
      {
        id: uid(),
        name: "High-load science review",
        offset: 2,
        duration: 2,
        type: "science",
        notes:
          "Illustrative task to reschedule away from an eclipse if power reserve permits.",
        done: false,
      },
    ];
  } else {
    s.name = "Site04 rover systems study";
    s.site = {
      name: "Site04 DEM study point",
      lat: -89.7668,
      lon: -171.87,
      height: 0,
    };
    s.start = "2026-11-14T00:00:00Z";
    s.analysis.horizon_step_deg = 0.5;
    s.description =
      "NASA LOLA Site04 surface heights and regional terrain support this study point. Coordinate selected inside DEM coverage for research; not an approved landing location or VIPER trajectory. NASA VIPER operations motivate the light/energy/communication trade-off. Times and rover hardware are illustrative.";
    s.events = [
      {
        id: uid(),
        name: "Surface science",
        offset: 1,
        duration: 2,
        type: "science",
        notes:
          "Inspect ranked candidate windows, then recalculate after moving the activity.",
        done: false,
      },
      {
        id: uid(),
        name: "DTE data review",
        offset: 5,
        duration: 1,
        type: "communication",
        notes:
          "Requires sampled station access and nonnegative nominal RF margin; no DSN reservation.",
        done: false,
      },
    ];
  }
  s.compareSite = { ...s.site };
  s.compareStart = new Date(Date.parse(s.start) + 86400000).toISOString();
  return s;
}
