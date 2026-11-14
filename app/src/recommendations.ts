import type { LunarPoint } from "./surfaceRoutes";
export type SiteCandidate = {
  id: string;
  start?: string;
  station?: string;
  station_access_hours?: number | null;
  reference_station_access_hours?: number;
  joint_sun_station_hours?: number | null;
  reference_joint_sun_station_hours?: number;
  days_from_today?: number;
  meets_sun_contact_thresholds?: boolean;
  lat: number;
  lon: number;
  distance_km: number;
  bearing_deg?: number | null;
  ground_m: number | null;
  solar_hours: number | null;
  reference_solar_hours?: number | null;
  ideal_solar_hours: number;
  known_terrain_hours: number;
  terrain_unknown_hours?: number;
  estimate_basis?: string;
  energy_wh: number | null;
  reference_energy_wh?: number | null;
  delta_energy_wh: number | null;
  reference_delta_energy_wh?: number | null;
  delta_solar_hours: number | null;
  better_sunlight: boolean;
  reference_plane_better?: boolean;
  coverage: string;
  search_resolution?: string;
  landing: { status: string; slope_deg?: number; roughness_rms_m?: number };
  landing_clearance: string;
};
export type SiteSearch = {
  fingerprint?: string;
  version?: string;
  same_date_candidates?: SiteCandidate[];
  same_date_provisional_candidates?: SiteCandidate[];
  same_date_screened_count?: number;
  same_date_terrain_check_count?: number;
  same_date_terrain_assessed_count?: number;
  same_date_terrain_unassessed_count?: number;
  same_date_result_limit?: number;
  same_date_minimum_separation_km?: number;
  date_result_minimum_separation_km?: number;
  area_scope?: "moon" | "radius" | "region";
  region_id?: string;
  region?: LunarPoint[];
  region_sample_count?: number;
  region_windows?: { start: string; known: number; sampled: number; passing: number;
    mean_sun_hours: number; mean_joint_hours: number }[];
  date_candidates?: SiteCandidate[];
  searched_from?: string;
  days_examined?: number;
  date_search_limit_days?: number;
  qualification?: string;
  baseline: SiteCandidate;
  candidates: SiteCandidate[];
  global_candidates?: SiteCandidate[];
  global_nearest?: SiteCandidate | null;
  global_best?: SiteCandidate | null;
  method: string;
  limits: string[];
  start: string;
  duration: number;
  radius_km: number;
  samples: number;
  global_samples?: number;
  global_spacing_deg?: number;
};

export function validSiteSearch(value: unknown): value is SiteSearch {
  try {
    const s = value as SiteSearch;
    const candidate = (c: SiteCandidate) =>
      !!c &&
      typeof c.id === "string" &&
      Number.isFinite(c.lat) &&
      Math.abs(c.lat) <= 90 &&
      Number.isFinite(c.lon) &&
      Math.abs(c.lon) <= 180 &&
      [
        "station_access_hours",
        "reference_station_access_hours",
        "joint_sun_station_hours",
        "reference_joint_sun_station_hours",
        "solar_hours",
        "reference_solar_hours",
        "energy_wh",
        "reference_energy_wh",
        "delta_energy_wh",
        "reference_delta_energy_wh",
        "delta_solar_hours",
      ].every(
        (k) =>
          c[k as keyof SiteCandidate] === undefined ||
          c[k as keyof SiteCandidate] === null ||
          Number.isFinite(c[k as keyof SiteCandidate]),
      ) &&
      (c.start === undefined || (typeof c.start === "string" && Number.isFinite(Date.parse(c.start)))) &&
      (c.days_from_today === undefined || (Number.isFinite(c.days_from_today) && c.days_from_today >= 0)) &&
      !!c.landing &&
      typeof c.landing.status === "string" &&
      typeof c.better_sunlight === "boolean" &&
      (c.reference_plane_better === undefined || typeof c.reference_plane_better === "boolean") &&
      typeof c.coverage === "string" &&
      (c.bearing_deg === undefined || c.bearing_deg === null || Number.isFinite(c.bearing_deg)) &&
      (c.ground_m === null || Number.isFinite(c.ground_m)) &&
      (c.landing.slope_deg === undefined ||
        Number.isFinite(c.landing.slope_deg)) &&
      (c.landing.roughness_rms_m === undefined ||
        Number.isFinite(c.landing.roughness_rms_m)) &&
      Number.isFinite(c.distance_km) &&
      Number.isFinite(c.known_terrain_hours);
    return (
      !!s &&
      candidate(s.baseline) &&
      (s.region_windows === undefined || (Array.isArray(s.region_windows) && s.region_windows.length <= 5
        && s.region_windows.every(w => w && typeof w.start === "string" && Number.isFinite(Date.parse(w.start))
          && [w.known,w.sampled,w.passing].every(v => Number.isInteger(v) && v >= 0 && v <= 16)
          && w.passing <= w.known && w.known <= w.sampled
          && [w.mean_sun_hours,w.mean_joint_hours].every(v => Number.isFinite(v) && v >= 0)))) &&
      Array.isArray(s.candidates) &&
      s.candidates.length <= 32 &&
      s.candidates.every(candidate) &&
      (s.global_candidates === undefined || (Array.isArray(s.global_candidates) && s.global_candidates.length <= 32 && s.global_candidates.every(candidate))) &&
      (s.global_nearest === undefined || s.global_nearest === null || candidate(s.global_nearest)) &&
      (s.global_best === undefined || s.global_best === null || candidate(s.global_best)) &&
      [s.same_date_candidates, s.same_date_provisional_candidates, s.date_candidates].every((list) => list === undefined || (Array.isArray(list) && list.length <= 512 && list.every(candidate))) &&
      typeof s.method === "string" &&
      typeof s.start === "string" &&
      Number.isFinite(s.duration) &&
      Number.isFinite(s.radius_km) &&
      Array.isArray(s.limits)
    );
  } catch {
    return false;
  }
}
