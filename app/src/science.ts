export const SCIENCE_DEFAULTS = {
  enabled: false,
  terrain: true,
  mast_m: 2,
  height_uncertainty_m: 0.5,
  horizon_range_km: 250,
  horizon_step_deg: 0.5,
  station: "DSS-14",
  station_mask_deg: 10,
  frequency_ghz: 8.4,
  tx_power_w: 20,
  tx_gain_dbi: 12,
  rx_diameter_m: 70,
  rx_efficiency: 0.55,
  system_noise_k: 30,
  other_losses_db: 3,
  bitrate_bps: 1000000,
  required_ebno_db: 3,
  implementation_loss_db: 2,
  reserve_margin_db: 3,
  panel_area_m2: 2,
  panel_efficiency: 0.28,
  panel_derating: 0.7,
  panel_mode: "tracking",
  panel_tilt_deg: 0,
  panel_azimuth_deg: 0,
  battery_wh: 2000,
  initial_soc: 0.8,
  minimum_soc: 0.2,
  charge_efficiency: 0.9,
  discharge_efficiency: 0.9,
  base_load_w: 60,
  active_load_w: 120,
  footprint_m: 20,
  slope_limit_deg: 10,
  roughness_limit_m: 0.3,
  vehicle: "rover",
  hop_dry_mass_kg: 20,
  hop_propellant_kg: 2,
  hop_isp_s: 220,
  hop_speed_m_s: 20,
  hop_angle_deg: 45,
};
export type ScienceConfig = typeof SCIENCE_DEFAULTS;
export const SCIENCE_LIMITS: Partial<
  Record<keyof ScienceConfig, [number, number]>
> = {
  mast_m: [0.1, 100],
  height_uncertainty_m: [0, 100],
  horizon_range_km: [10, 250],
  horizon_step_deg: [0.25, 2],
  station_mask_deg: [0, 90],
  frequency_ghz: [0.1, 100],
  tx_power_w: [0.001, 100000],
  tx_gain_dbi: [-20, 100],
  rx_diameter_m: [0.1, 100],
  rx_efficiency: [0.01, 1],
  system_noise_k: [1, 100000],
  other_losses_db: [0, 100],
  bitrate_bps: [1, 1e10],
  required_ebno_db: [-10, 50],
  implementation_loss_db: [0, 30],
  reserve_margin_db: [0, 30],
  panel_area_m2: [0, 10000],
  panel_efficiency: [0, 1],
  panel_derating: [0, 1],
  panel_tilt_deg: [0, 180],
  panel_azimuth_deg: [0, 360],
  battery_wh: [0.1, 1e8],
  initial_soc: [0, 1],
  minimum_soc: [0, 1],
  charge_efficiency: [0.01, 1],
  discharge_efficiency: [0.01, 1],
  base_load_w: [0, 1e6],
  active_load_w: [0, 1e6],
  footprint_m: [10, 200],
  slope_limit_deg: [0, 60],
  roughness_limit_m: [0, 100],
  hop_dry_mass_kg: [0.1, 1e6],
  hop_propellant_kg: [0, 1e6],
  hop_isp_s: [1, 1000],
  hop_speed_m_s: [0, 100],
  hop_angle_deg: [1, 89],
};
export function validScience(value: unknown): value is ScienceConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as ScienceConfig;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.terrain === "boolean" &&
    ["DSS-14", "DSS-43", "DSS-63"].includes(v.station) &&
    ["tracking", "fixed"].includes(v.panel_mode) &&
    ["rover", "lander", "hopper", "crewed"].includes(v.vehicle) &&
    Object.entries(SCIENCE_LIMITS).every(([key, [lo, hi]]) => {
      const n = v[key as keyof ScienceConfig];
      return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
    }) &&
    v.initial_soc >= v.minimum_soc
  );
}
export type TerrainProfile = {
  status: string;
  complete: boolean;
  reason: string;
  observer_height_m?: number | null;
  ground_height_m?: number;
  native_site_pixel_m?: number;
  azimuth_step_deg?: number;
  range_km?: number;
  far_field_upper_deg?: number;
  global_height_bound_m?: number;
  height_perturbation_m?: number;
  azimuth_deg: number[];
  elevation_deg: (number | null)[];
  upper_deg?: number[];
  lower_deg?: number[];
  bounded_sectors?: boolean[];
  limitations?: string[];
};
export type StationState = {
  station: string;
  name: string;
  lunar_azimuth_deg: number;
  lunar_elevation_deg: number;
  earth_station_elevation_deg: number;
  station_mask_deg: number;
  geometric_access: boolean;
  terrain_access: boolean | null;
  access: boolean | null;
  rf: {
    distance_km: number;
    free_space_loss_db: number;
    eirp_dbw: number;
    rx_gain_dbi: number;
    received_power_dbw: number;
    cn0_dbhz: number;
    ebno_db: number;
    nominal_margin_db: number;
    propagation_delay_s: number;
  };
};
export type ScienceRow = {
  time: string;
  elapsed: number;
  eclipse: {
    state: string;
    unocculted_fraction: number;
    separation_deg: number;
  };
  solar_fraction_nominal: number;
  solar_fraction_lower: number;
  solar_fraction_upper: number;
  terrain_fraction: number | null;
  terrain_unknown: boolean;
  station: StationState;
  power_nominal_w: number;
  power_lower_w: number;
  power_upper_w: number;
  load_w: number;
  battery_nominal_wh: number;
  battery_conservative_wh: number;
  soc_nominal: number;
  soc_conservative: number;
};
export type ScienceResult = {
  version: string;
  qualification: string;
  source_manifest?: {
    version: string;
    sources: { file: string; url: string; sha256: string; bytes: number }[];
  };
  model_code_sha256?: Record<string, string>;
  inputs: ScienceConfig;
  terrain: TerrainProfile;
  rows: ScienceRow[];
  events: {
    kind: string;
    time: string;
    elapsed_hours: number;
    bracket_seconds: number;
    direction: string;
    terrain_dependent: boolean;
  }[];
  power: {
    generated_nominal_wh: number;
    load_wh: number;
    minimum_soc_nominal: number;
    minimum_soc_conservative: number;
    end_soc_nominal: number;
    reserve_floor: number;
    nominal_unserved_wh: number;
    nominal_reserve_pass: boolean;
    conservative_reserve_pass: boolean;
    model: string;
  };
  access: {
    station: string;
    available_hours_at_samples: number;
    unknown_terrain_hours: number;
    eclipse_hours_at_samples: number;
    dsn_reservation: boolean;
  };
  landing: {
    status: string;
    reason?: string;
    slope_deg?: number;
    roughness_rms_m?: number;
    peak_to_peak_residual_m?: number;
    footprint_radius_m?: number;
    grid_m?: number;
    landing_clearance: string;
    unknown_hazards?: string[];
  };
  hopper?: {
    ideal_delta_v_m_s: number;
    ideal_ballistic_range_m: number;
    ideal_flight_time_s: number;
    ideal_apex_m: number;
    two_impulse_delta_v_demand_m_s: number;
    ideal_propellant_margin_m_s: number;
    scope: string;
  } | null;
  candidate_windows: {
    activity_id: string;
    activity_name: string;
    status: string;
    method: string;
    windows: {
      start_offset_hours: number;
      start_utc: string;
      score: number;
      minimum_projected_soc: number;
      contact_at_samples: boolean;
      duration_hours: number;
    }[];
  }[];
  events_method: {
    search_step_seconds: number;
    root_bracket_tolerance_seconds: number;
    complete_event_search: boolean;
    limitation: string;
  };
  earth_orientation: Record<string, string>;
  limitations: string[];
};
export const SCIENCE_SOURCES = [
  {
    id: "lro",
    title: "NASA LRO definitive trajectory (FDF/GSFC ACTUAL)",
    url: "https://naif.jpl.nasa.gov/pub/naif/pds/data/lro-l-spice-6-v1.0/lrosp_1000/data/spk/lrorg_2022258_2022349_v01.lbl",
    use: "Reconstructed LRO positions 15 September–15 December 2022; spacecraft shadow fractions are spherical-disk estimates, not reconstructed vehicle power.",
  },
  {
    id: "spice",
    title: "NASA NAIF: apparent geometry and occultations",
    url: "https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/occult_c.html",
    use: "Kernel-based apparent body geometry; this app uses a spherical-disk overlap approximation for eclipse fractions.",
  },
  {
    id: "terrain",
    title: "NASA LOLA regional DEMs (MOON_ME / DE421)",
    url: "https://pgda.gsfc.nasa.gov/products/90",
    use: "80 m south-polar regional surface heights. Native cells sampled; not a global or rock-scale hazard model.",
  },
  {
    id: "site",
    title: "NASA LOLA 5 m study-site terrain and uncertainty",
    url: "https://pgda.gsfc.nasa.gov/products/78",
    use: "Site04 native 5 m heights. Pixel spacing differs from effective terrain resolution; uncertainty ensemble not ingested.",
  },
  {
    id: "dsn",
    title: "DSN Telecommunications Link Design Handbook",
    url: "https://deepspace.jpl.nasa.gov/dsndocs/810-005/",
    use: "Link-budget and coverage framework. Hardware settings and elevation mask in this app are editable assumptions.",
  },
  {
    id: "stations",
    title: "NASA NAIF station coordinates",
    url: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/stations/earthstns_itrf93_260814.cmt",
    use: "DSS-14, DSS-43, DSS-63 station locations; historical station operations are not reconstructed.",
  },
  {
    id: "eop",
    title: "NASA NAIF Earth-orientation prediction limits",
    url: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_1962_260806_2126_combined.cmt",
    use: "Historical and low-accuracy long-term ITRF93 orientations, overridden by a dated short-term kernel within its coverage.",
  },
  {
    id: "viper",
    title: "NASA VIPER lunar operations",
    url: "https://science.nasa.gov/mission/viper/lunar-operations/",
    use: "Motivates coupled light, battery, slope and communication screening; does not validate this implementation.",
  },
  {
    id: "eclipse",
    title: "NASA Moon eclipses and LRO power conservation",
    url: "https://science.nasa.gov/moon/eclipses/",
    use: "Explains why eclipse planning matters; the example includes an LRO definitive trajectory and separate hypothetical surface power model.",
  },
  {
    id: "apollo",
    title: "NASA Apollo 17 landing record",
    url: "https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo17info.html",
    use: "Historical landing epoch and rounded Taurus-Littrow coordinates; not reconstructed flight hardware.",
  },
  {
    id: "apollo-timeline",
    title: "NASA Apollo 17 event timeline",
    url: "https://www.nasa.gov/wp-content/uploads/static/history/SP-4029/Apollo_17i_Timeline.htm",
    use: "Published activity timings; the landing record differs by one second between NASA summaries.",
  },
  {
    id: "splice",
    title: "NASA SPLICE landing hazard detection",
    url: "https://www.nasa.gov/safe-and-precise-landing-integrated-capabilities-evolution-splice/",
    use: "Explains the onboard sensing/guidance missing from a DEM-only landing screen.",
  },
  {
    id: "hopper",
    title: "NASA-supported Micro Nova propulsive hopper",
    url: "https://www.nasa.gov/news-release/liftoff-nasa-tech-science-en-route-to-moon-with-intuitive-machines/",
    use: "Vacuum propulsive-hop motivation. The toy hop model is not a Micro Nova trajectory or vehicle model.",
  },
];
