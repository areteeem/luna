"""Deterministic nearby and coarse Moon-wide solar screening.

The global lattice is a bounded first-pass search, not a continuous optimizer.
Unknown terrain stays explicit and never becomes landing clearance.
"""
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import spiceypy as sp

from terrain_model import elevations, horizon, horizon_at, safety_screen
from mission_models import normalize, observer_basis, body_at, eclipse, disk_visible_fraction, station_at, AU_KM

MOON_RADIUS_KM = 1737.4
GLOBAL_SPACING_DEG = 15.0
GLOBAL_COARSE_SAMPLES = 13
GLOBAL_DETAIL_LIMIT = 8
GLOBAL_RESULT_LIMIT = 12
GLOBAL_RESULT_SEPARATION_KM = 500.0


def destination(lat, lon, bearing, distance_km):
    p, l, b = map(math.radians, [lat, lon, bearing])
    d = distance_km / MOON_RADIUS_KM
    q = math.asin(math.sin(p) * math.cos(d) + math.cos(p) * math.sin(d) * math.cos(b))
    r = l + math.atan2(math.sin(b) * math.sin(d) * math.cos(p), math.cos(d) - math.sin(p) * math.sin(q))
    return math.degrees(q), (math.degrees(r) + 180) % 360 - 180


def surface_distance_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MOON_RADIUS_KM * math.asin(math.sqrt(min(1.0, h)))


def global_lattice(spacing_deg=GLOBAL_SPACING_DEG):
    """Return a repeatable latitude/longitude mesh with approximately even spacing."""
    points = []
    latitudes = list(np.arange(-90.0, 90.0 + spacing_deg / 2, spacing_deg))
    if latitudes[-1] < 90:
        latitudes.append(90.0)
    for lat in latitudes:
        around = max(1, round(360 * max(0.0, math.cos(math.radians(lat))) / spacing_deg))
        for index in range(around):
            lon = -180 + 360 * index / around
            points.append((float(lat), float((lon + 180) % 360 - 180)))
    return points


def _et_samples(start, hours, count):
    times = np.linspace(0, hours, count)
    # Left-sampled, half-open integration matches the mission analysis convention.
    step_hours = hours / (count - 1)
    ets = [
        sp.str2et((start + timedelta(hours=float(t))).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'))
        for t in times[:-1]
    ]
    return times, ets, step_hours


def _evaluate_site(payload, cfg, start, et_samples, step_hours, lat, lon, distance_km, bearing_deg, site_id, resolution, include_landing=True, region_profiles=None):
    key = (lat, lon)
    if region_profiles is not None and key in region_profiles:
        profile, ground = region_profiles[key]
    else:
        profile = horizon(lat, lon, cfg['mast_m'], cfg['height_uncertainty_m'], cfg['horizon_range_km'], cfg['horizon_step_deg']) if cfg['terrain'] else {'azimuth_deg': [], 'status': 'disabled'}
        ground, _ = elevations(np.asarray(lon), np.asarray(lat))
        if region_profiles is not None:
            region_profiles[key] = profile, ground
    height = profile.get('observer_height_m')
    if height is None:
        height = float(payload.get('height', 0))
    observer, up, east, north = observer_basis(lat, lon, height)
    known_hours = solar_hours = generation_wh = ideal_hours = 0.0
    access_hours = joint_hours = access_unknown_hours = 0.0
    reference_access_hours = reference_joint_hours = 0.0
    for et in et_samples:
        sun = body_at('SUN', et, observer, up, east, north)
        earth = body_at('EARTH', et, observer, up, east, north)
        station = station_at(et, observer, up, east, north, cfg, profile)
        reference_access = station['geometric_access'] and station['rf']['nominal_margin_db'] >= 0
        access = station['access'] is True and station['rf']['nominal_margin_db'] >= 0
        access_hours += step_hours if access else 0
        access_unknown_hours += step_hours if station['access'] is None else 0
        reference_access_hours += step_hours if reference_access else 0
        unocculted = eclipse(sun, earth)['unocculted_fraction']
        ideal_fraction = disk_visible_fraction(sun['elevation'], sun['radius'], 0.0) * unocculted
        ideal_hours += ideal_fraction * step_hours
        terrain_h = horizon_at(profile, sun['azimuth']) if cfg['terrain'] else 0.0
        terrain_known = terrain_h is not None
        if terrain_known:
            known_hours += step_hours
        else:
            # Reference-plane visibility is an estimate when the local DEM horizon is absent.
            terrain_h = 0.0
        fraction = disk_visible_fraction(sun['elevation'], sun['radius'], terrain_h) * unocculted
        solar_hours += fraction * step_hours
        joint_hours += step_hours if access and fraction >= 0.5 else 0
        reference_joint_hours += step_hours if reference_access and fraction >= 0.5 else 0
        if cfg['panel_mode'] == 'tracking':
            incidence = 1.0
        else:
            incidence = max(0.0,
                math.sin(math.radians(sun['elevation'])) * math.cos(math.radians(cfg['panel_tilt_deg']))
                + math.cos(math.radians(sun['elevation'])) * math.sin(math.radians(cfg['panel_tilt_deg']))
                * math.cos(math.radians(sun['azimuth'] - cfg['panel_azimuth_deg'])))
        generation_wh += 1361 * (AU_KM / np.linalg.norm(sun['vector'])) ** 2 * cfg['panel_area_m2'] * cfg['panel_efficiency'] * cfg['panel_derating'] * fraction * incidence * step_hours

    unknown_hours = max(0.0, float(payload['duration']) - known_hours) if cfg['terrain'] else 0.0
    landing = safety_screen(lat, lon, cfg['footprint_m'], cfg['slope_limit_deg'], cfg['roughness_limit_m']) if include_landing else {
        'status': 'not-screened',
        'reason': 'Coarse Moon-wide pass; detailed terrain screening is reserved for refined candidates.',
        'landing_clearance': 'not established',
    }
    return {
        'id': site_id,
        'start': start.isoformat().replace('+00:00', 'Z'),
        'station': cfg['station'],
        'station_access_hours': access_hours if access_unknown_hours <= 1e-7 else None,
        'reference_station_access_hours': reference_access_hours,
        'joint_sun_station_hours': joint_hours if access_unknown_hours <= 1e-7 and unknown_hours <= 1e-7 else None,
        'reference_joint_sun_station_hours': reference_joint_hours,
        'station_unknown_hours': access_unknown_hours,
        'lat': lat,
        'lon': lon,
        'distance_km': distance_km,
        'bearing_deg': bearing_deg,
        'ground_m': float(ground) if np.isfinite(ground) else None,
        'solar_hours': solar_hours if unknown_hours <= 1e-7 else None,
        'reference_solar_hours': solar_hours,
        'ideal_solar_hours': ideal_hours,
        'known_terrain_hours': known_hours,
        'terrain_unknown_hours': unknown_hours,
        'energy_wh': generation_wh if unknown_hours <= 1e-7 else None,
        'reference_energy_wh': generation_wh,
        'coverage': profile['status'],
        'estimate_basis': 'sampled DEM horizon where covered; ideal 0° reference plane where terrain is unavailable',
        'landing': landing,
        'landing_clearance': 'not established',
        'terrain_mode': bool(cfg['terrain']),
        'search_resolution': resolution,
    }


def _with_deltas(points, base):
    for point in points:
        point['delta_solar_hours'] = point['solar_hours'] - base['solar_hours'] if point['solar_hours'] is not None and base['solar_hours'] is not None else None
        point['delta_energy_wh'] = point['energy_wh'] - base['energy_wh'] if point['energy_wh'] is not None and base['energy_wh'] is not None else None
        point['reference_delta_energy_wh'] = point['reference_energy_wh'] - base['reference_energy_wh']
        threshold = max(1.0, 0.001 * max(0.0, base['reference_energy_wh']))
        complete = point['terrain_unknown_hours'] <= 1e-7 and base['terrain_unknown_hours'] <= 1e-7
        point['better_sunlight'] = bool(complete and point['delta_energy_wh'] is not None and point['delta_energy_wh'] > threshold)
        point['reference_plane_better'] = bool(point['reference_delta_energy_wh'] > threshold)
    return points


def qualifies(candidate, hours):
    """Explicit screening thresholds; incomplete terrain remains provisional."""
    sun = candidate['solar_hours'] if candidate['solar_hours'] is not None else candidate['reference_solar_hours']
    access = candidate['station_access_hours'] if candidate['station_access_hours'] is not None else candidate['reference_station_access_hours']
    joint = candidate['joint_sun_station_hours'] if candidate['joint_sun_station_hours'] is not None else candidate['reference_joint_sun_station_hours']
    return sun >= hours * .5 and access >= hours * .1 and joint >= hours * .05


def qualifies_without_tradeoffs(candidate, hours):
    """Require every configured mission-start screen to pass on measured data."""
    return (
        qualifies(candidate, hours)
        and candidate.get('terrain_unknown_hours', 0.0) <= 1e-7
        and candidate.get('station_unknown_hours', 0.0) <= 1e-7
        and candidate.get('solar_hours') is not None
        and candidate.get('station_access_hours') is not None
        and candidate.get('joint_sun_station_hours') is not None
        and candidate.get('landing', {}).get('status') == 'screen-within-threshold'
    )


def _rank_key(candidate, hours):
    """Rank screening results without treating missing terrain as measured data."""
    terrain_complete = candidate.get('terrain_unknown_hours', 0.0) <= 1e-7
    station_hours = candidate.get('station_access_hours')
    if station_hours is None:
        station_hours = candidate.get('reference_station_access_hours', 0.0)
    joint_hours = candidate.get('joint_sun_station_hours')
    if joint_hours is None:
        joint_hours = candidate.get('reference_joint_sun_station_hours', 0.0)
    solar_hours = candidate.get('solar_hours')
    if solar_hours is None:
        solar_hours = candidate.get('reference_solar_hours', 0.0)
    energy = candidate.get('energy_wh')
    if energy is None:
        energy = candidate.get('reference_energy_wh', 0.0)
    return (qualifies(candidate, hours), terrain_complete, joint_hours, station_hours,
            solar_hours, energy, -candidate.get('distance_km', 0.0))


def _diverse_shortlist(candidates, hours, limit=GLOBAL_RESULT_LIMIT,
                       separation_km=GLOBAL_RESULT_SEPARATION_KM):
    """Return high-ranking, spatially separated candidates from a full-area screen."""
    ranked = sorted(candidates, key=lambda c: _rank_key(c, hours), reverse=True)
    selected = []
    deferred = []
    for candidate in ranked:
        if all(surface_distance_km(candidate['lat'], candidate['lon'], chosen['lat'], chosen['lon']) >= separation_km
               for chosen in selected):
            selected.append(candidate)
            if len(selected) >= limit:
                break
        else:
            deferred.append(candidate)
    if len(selected) < limit:
        chosen_ids = {candidate['id'] for candidate in selected}
        remaining = [candidate for candidate in deferred if candidate['id'] not in chosen_ids]
        selected.extend(remaining[:limit - len(selected)])
    return selected


def recommend(payload):
    cfg = normalize({**(payload.get('analysis') or {}), 'enabled': True})
    lat = float(payload['lat'])
    lon = float(payload['lon'])
    hours = float(payload['duration'])
    radius = float(payload.get('radius_km', 2))
    if not all(map(math.isfinite, [lat, lon, hours, radius])) or not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 < hours <= 744 and .1 <= radius <= 20):
        raise ValueError('Invalid search coordinate, duration or radius (0.1-20 km)')
    start = datetime.fromisoformat(payload['start'].replace('Z', '+00:00'))
    if start.tzinfo is None or not 1969 <= start.year <= 2049 or (start + timedelta(hours=hours)).year > 2049:
        raise ValueError('Supported UTC dates: 1969-2049')

    region = payload.get('area_scope') == 'region'
    if region:
        from study_region import region_samples
        samples = region_samples(payload.get('region'))
    detail_count = min(97, max(13, math.ceil(hours * 4) + 1))
    detail_times, detail_ets, detail_step = _et_samples(start, hours, detail_count)
    local_sites = [(lat, lon, 0.0, 0.0, 'local-origin')]
    local_sites += [(*destination(lat, lon, bearing, radius * factor), radius * factor, float(bearing), f'local-{factor}-{bearing}')
                    for factor in [.5, 1.] for bearing in range(0, 360, 45)]
    if region:
        local_sites[1:] = [(phi,lam,surface_distance_km(lat,lon,phi,lam),None,f'region-{i}')
                           for i,(phi,lam) in enumerate(samples)]
    resolution = 'interior study region sample' if region else 'within selected radius'
    region_profiles = {} if region else None
    local = [_evaluate_site(payload, cfg, start, detail_ets, detail_step, phi, lam, distance, bearing, site_id, resolution, region_profiles=region_profiles)
             for phi, lam, distance, bearing, site_id in local_sites]
    baseline = local[0]
    # The baseline is a reference row. Its delta and comparison flag are
    # undefined, so serialize neutral values accepted by saved-study validation.
    baseline.update({'delta_solar_hours': None, 'delta_energy_wh': None,
                     'reference_delta_energy_wh': 0.0, 'better_sunlight': False,
                     'reference_plane_better': False})
    _with_deltas(local[1:], baseline)
    local[1:] = sorted(local[1:], key=lambda c: (c['terrain_unknown_hours'] <= 1e-7, c['reference_energy_wh']), reverse=True)

    # Coarse full-Moon pass: fixed mesh, short time sample, ideal horizon. Refine only
    # the strongest and nearest apparent improvements using the selected terrain model.
    _, global_ets, global_step = _et_samples(start, hours, GLOBAL_COARSE_SAMPLES)
    coarse_cfg = {**cfg, 'terrain': False}
    coarse_baseline = _evaluate_site(payload, coarse_cfg, start, global_ets, global_step,
                                     lat, lon, 0.0, 0.0, 'coarse-origin',
                                     f'coarse {GLOBAL_SPACING_DEG:g}° global grid baseline', include_landing=False)
    coarse = []
    for index, (phi, lam) in enumerate([] if region else global_lattice()):
        if surface_distance_km(lat, lon, phi, lam) < radius * .75:
            continue
        coarse.append(_evaluate_site(payload, coarse_cfg, start, global_ets, global_step, phi, lam,
                                     surface_distance_km(lat, lon, phi, lam), None,
                                     f'global-grid-{index}', f'coarse {GLOBAL_SPACING_DEG:g}° global grid', include_landing=False))
    _with_deltas(coarse, coarse_baseline)
    apparent_improvements = [c for c in coarse if c['reference_plane_better']]
    nearest_ids = {c['id'] for c in sorted(apparent_improvements, key=lambda c: c['distance_km'])[:4]}
    joint_ids = {c['id'] for c in sorted(coarse, key=lambda c: (qualifies(c, hours), c['reference_joint_sun_station_hours'], c['reference_energy_wh']), reverse=True)[:3]}
    terrain_ids = {c['id'] for c in sorted((c for c in coarse if c['ground_m'] is not None), key=lambda c: (qualifies(c, hours), c['reference_joint_sun_station_hours'], c['reference_energy_wh']), reverse=True)[:4]}
    brightest_ids = {c['id'] for c in sorted(coarse, key=lambda c: c['reference_energy_wh'], reverse=True)[:4]}
    selected = sorted((c for c in coarse if c['id'] in joint_ids | nearest_ids | brightest_ids | terrain_ids), key=lambda c: (c['id'] in terrain_ids, c['id'] in joint_ids, c['reference_joint_sun_station_hours'], c['reference_energy_wh']), reverse=True)[:GLOBAL_DETAIL_LIMIT]
    global_candidates = []
    for candidate in selected:
        detailed = _evaluate_site(payload, cfg, start, detail_ets, detail_step,
                                     candidate['lat'], candidate['lon'], candidate['distance_km'], None,
                                  candidate['id'], f'refined candidate from {GLOBAL_SPACING_DEG:g}° global grid')
        _with_deltas([detailed], baseline)
        detailed['coarse_global_energy_wh'] = candidate['reference_energy_wh']
        global_candidates.append(detailed)
    global_nearest = min((c for c in global_candidates if c['reference_plane_better']), key=lambda c: c['distance_km'], default=None)
    global_best = max(global_candidates, key=lambda c: c['reference_energy_wh'], default=None)

    for candidate in global_candidates + local[1:]:
        candidate['meets_sun_contact_thresholds'] = qualifies(candidate, hours)
    for point in coarse:
        _with_deltas([point], coarse_baseline)
        point['meets_sun_contact_thresholds'] = qualifies(point, hours)
        point['terrain_mode'] = bool(cfg['terrain'])
        point['terrain_unknown_hours'] = float(hours) if cfg['terrain'] else 0.0
        point['coverage'] = 'reference-plane global screening; local DEM not evaluated'
        if cfg['terrain']:
            point.update({'solar_hours': None, 'energy_wh': None,
                          'delta_solar_hours': None, 'delta_energy_wh': None,
                          'station_access_hours': None, 'joint_sun_station_hours': None,
                          'better_sunlight': False})
    refined_by_id = {c['id']: c for c in global_candidates}
    mission_area = (local[1:] if payload.get('area_scope') in ('radius','region') else coarse + local[1:])
    mission_area = [refined_by_id.get(c['id'], c) for c in mission_area]
    same_date_screened_count = len(mission_area)
    shortlist = _diverse_shortlist(
        mission_area, hours,
        separation_km=0.0 if region else GLOBAL_RESULT_SEPARATION_KM if payload.get('area_scope') != 'radius' else max(0.5, radius / 4),
    )
    # The visible qualifying list is variable length: only measured candidates
    # meeting solar, station, overlap and terrain limits can appear there.
    # Keep a separate, opt-in preview for strong reference-plane candidates so
    # missing DEM coverage is visible without being promoted to a recommendation.
    same_date_provisional = []
    for candidate in shortlist:
        detailed = refined_by_id.get(candidate['id'])
        if detailed is None and candidate['id'].startswith('global-grid-'):
            detailed = _evaluate_site(payload, cfg, start, detail_ets, detail_step,
                candidate['lat'], candidate['lon'], candidate['distance_km'], None,
                candidate['id'], f'refined shortlist candidate from {GLOBAL_SPACING_DEG:g}° global grid')
            _with_deltas([detailed], baseline)
        elif detailed is None:
            detailed = candidate
        detailed['meets_sun_contact_thresholds'] = qualifies(detailed, hours)
        same_date_provisional.append(detailed)
    attempted_ids = {candidate['id'] for candidate in same_date_provisional}
    covered_solar_candidates = sorted(
        (candidate for candidate in mission_area
         if candidate['id'] not in attempted_ids and qualifies(candidate, hours)
         and candidate.get('ground_m') is not None),
        key=lambda candidate: _rank_key(candidate, hours), reverse=True,
    )
    for candidate in covered_solar_candidates[:GLOBAL_DETAIL_LIMIT]:
        detailed = refined_by_id.get(candidate['id'])
        if detailed is None:
            detailed = candidate if region else _evaluate_site(payload, cfg, start, detail_ets, detail_step,
                candidate['lat'], candidate['lon'], candidate['distance_km'], None,
                candidate['id'], f'terrain-covered candidate from {GLOBAL_SPACING_DEG:g}° global grid')
            _with_deltas([detailed], baseline)
        detailed['meets_sun_contact_thresholds'] = qualifies(detailed, hours)
        same_date_provisional.append(detailed)
    same_date = sorted(
        (candidate for candidate in same_date_provisional
         if qualifies_without_tradeoffs(candidate, hours)),
        key=lambda candidate: _rank_key(candidate, hours), reverse=True,
    )[:GLOBAL_RESULT_LIMIT]
    same_date_provisional.sort(key=lambda candidate: _rank_key(candidate, hours), reverse=True)
    # Search UTC days in chronological order from the actual request time, never
    # a random date. Return one best refined result per date, preserving duration.
    now = datetime.now(timezone.utc).replace(microsecond=0)
    date_candidates = []
    region_windows = []
    region_landing = {(c['lat'],c['lon']):c['landing'] for c in local[1:]}
    days_examined = 0
    for day in range(32):
        date_start = now if day == 0 else (now + timedelta(days=day)).replace(hour=0, minute=0, second=0)
        if (date_start + timedelta(hours=hours)).year > 2049:
            break
        days_examined += 1
        _, ets, step = _et_samples(date_start, hours, GLOBAL_COARSE_SAMPLES)
        if region:
            _, ets_detail, step_detail = _et_samples(date_start, hours, detail_count)
            rows = [_evaluate_site(payload,cfg,date_start,ets_detail,step_detail,phi,lam,
                    surface_distance_km(lat,lon,phi,lam),None,f'region-date-{day}-{i}',
                    'interior study region sample',include_landing=False,region_profiles=region_profiles)
                    for i,(phi,lam) in enumerate(samples)]
            known = [c for c in rows if c['terrain_unknown_hours'] <= 1e-7
                     and c['station_unknown_hours'] <= 1e-7 and c['solar_hours'] is not None
                     and c['joint_sun_station_hours'] is not None]
            if known:
                region_windows.append({
                    'start':rows[0]['start'], 'known':len(known), 'sampled':len(rows),
                    'passing':sum(qualifies(c,hours) for c in known),
                    'mean_sun_hours':sum(c['solar_hours'] for c in known)/len(known),
                    'mean_joint_hours':sum(c['joint_sun_station_hours'] for c in known)/len(known),
                })
            for c in rows:
                c['landing'] = region_landing[(c['lat'],c['lon'])]
                c['days_from_today'] = day
                c['meets_sun_contact_thresholds'] = qualifies(c,hours)
            candidates = [c for c in rows if qualifies_without_tradeoffs(c,hours)]
            if candidates and len(date_candidates) < 3:
                best = max(candidates,key=lambda c:_rank_key(c,hours))
                _with_deltas([best],baseline)
                date_candidates.append(best)
            continue
        matches = []
        for index, (phi, lam) in enumerate(global_lattice()):
            candidate = _evaluate_site(payload, coarse_cfg, date_start, ets, step, phi, lam,
                surface_distance_km(lat, lon, phi, lam), None, f'date-{day}-{index}',
                'chronological daily UTC search on a 15° global grid', include_landing=False)
            if qualifies(candidate, hours):
                matches.append(candidate)
        matches.sort(key=lambda c: (-c['reference_joint_sun_station_hours'], c['distance_km']))
        for candidate in matches[:8]:
            _, ets_detail, step_detail = _et_samples(date_start, hours, detail_count)
            detailed = _evaluate_site(payload, cfg, date_start, ets_detail, step_detail,
                candidate['lat'], candidate['lon'], candidate['distance_km'], None,
                candidate['id'], candidate['search_resolution'])
            _with_deltas([detailed], baseline)
            detailed['days_from_today'] = day
            detailed['meets_sun_contact_thresholds'] = qualifies(detailed, hours)
            separated_from_prior_dates = all(
                surface_distance_km(detailed['lat'], detailed['lon'], prior['lat'], prior['lon'])
                >= GLOBAL_RESULT_SEPARATION_KM
                for prior in date_candidates
            )
            if qualifies_without_tradeoffs(detailed, hours) and separated_from_prior_dates:
                date_candidates.append(detailed)
                break
        # Keep the closest start, then require later alternatives to represent
        # different UTC dates instead of returning three points from one date.
        if len(date_candidates) >= 3:
            break

    return {
        'version': 'sun-station-dates-v7',
        'same_date_candidates': same_date,
        # Keep the coverage counters for transparency, but never serialize
        # individual unassessed points as candidates or map/report markers.
        'same_date_provisional_candidates': [],
        'same_date_screened_count': same_date_screened_count,
        'same_date_terrain_check_count': len(same_date_provisional),
        'same_date_terrain_assessed_count': sum(c['landing']['status'] in ('screen-within-threshold', 'screen-exceeds-threshold') for c in same_date_provisional),
        'same_date_terrain_unassessed_count': sum(c['landing']['status'] == 'unassessed' for c in same_date_provisional),
        'same_date_result_limit': GLOBAL_RESULT_LIMIT,
        'same_date_minimum_separation_km': 0 if region else GLOBAL_RESULT_SEPARATION_KM if payload.get('area_scope') != 'radius' else max(0.5, radius / 4),
        'date_result_minimum_separation_km': 0 if region else GLOBAL_RESULT_SEPARATION_KM,
        'area_scope': payload.get('area_scope', 'moon'),
        'date_candidates': date_candidates,
        **({'region_windows':sorted(region_windows,key=lambda w:(
            -w['passing'],-w['known'],-w['mean_joint_hours'],-w['mean_sun_hours'],w['start']))[:5],
            'region_id':payload.get('region_id'),'region':payload['region'],
            'region_sample_count':len(samples)} if region else {}),
        'searched_from': now.isoformat().replace('+00:00', 'Z'),
        'days_examined': days_examined,
        'date_search_limit_days': 32,
        'qualification': 'At least 50% equivalent full-sun duration, station access with nonnegative nominal RF margin for at least 10% of mission duration, simultaneous sunlight/contact for at least 5% of duration, and measured terrain within configured limits. Points without measured terrain coverage are omitted from candidate lists.',
        'baseline': baseline,
        'candidates': [candidate for candidate in local[1:] if qualifies_without_tradeoffs(candidate, hours)],
        'global_candidates': same_date,
        'global_nearest': min(same_date, key=lambda c: c['distance_km'], default=None),
        'global_best': max(same_date, key=lambda c: c.get('energy_wh') or 0, default=None),
        'method': ('Interior study-region samples. Landing candidates pass terrain, sunlight and contact checks. Study windows rank sampled UTC starts by location coverage and overlap.' if region else f'Sunlight and selected-station contact screening; chronological date alternatives from today. 16 deterministic nearby points at half/full radius in 8 bearings; plus a deterministic {GLOBAL_SPACING_DEG:g}° latitude/longitude global screening grid. All mission-start nodes are screened, then only measured candidates passing every configured screen are displayed; missing terrain coverage is counted but individual unknown points are hidden. Results are spatially separated (at least {GLOBAL_RESULT_SEPARATION_KM:g} km for the whole Moon) and capped at {GLOBAL_RESULT_LIMIT}. Date alternatives require their own measured terrain pass and are separated by at least {GLOBAL_RESULT_SEPARATION_KM:g} km. The global screen uses {GLOBAL_COARSE_SAMPLES} time samples and is not a continuous global optimum.'),
        'limits': ([
            'Finite samples in the selected polygon and at daily UTC starts. Unsampled terrain and times may differ.',
            'Region window statistics use measured samples only and report the number assessed.',
            'Landing screening applies to the individual candidate and does not establish landing clearance.',
        ] if region else [
            'Moon-wide results are a coarse deterministic grid, not an exhaustive search; narrow or local optima between grid points can be missed.',
            'Reference-plane estimates outside terrain coverage do not model local horizon blockage and are not measured terrain results.',
            'A global candidate is not route-reachable, and the results do not establish landing clearance or safety.',
            'The nearby search uses a finer time step than the global first pass; recalculate a selected point before comparing it in detail.',
        ]),
        'start': payload['start'],
        'duration': hours,
        'radius_km': radius,
        'samples': detail_count,
        'global_samples': GLOBAL_COARSE_SAMPLES,
        'global_spacing_deg': GLOBAL_SPACING_DEG,
        'payload': payload,
    }
