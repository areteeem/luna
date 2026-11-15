"""Research-grade screening models. Each result carries scope, assumptions and unknowns."""
import math
from datetime import datetime,timezone,timedelta
from functools import lru_cache
import numpy as np
import spiceypy as sp
from terrain_model import horizon,horizon_at,safety_screen
R=1737.4
AU_KM=149597870.7
C_KM_S=299792.458
STATIONS={'DSS-14':{'id':'399014','name':'Goldstone DSS-14','diameter_m':70},'DSS-43':{'id':'399043','name':'Canberra DSS-43','diameter_m':70},'DSS-63':{'id':'399063','name':'Madrid DSS-63','diameter_m':70}}
DEFAULTS={'enabled':False,'terrain':True,'mast_m':2.,'height_uncertainty_m':.5,'horizon_range_km':250.,'horizon_step_deg':.5,'station':'DSS-14','station_mask_deg':10.,'frequency_ghz':8.4,'tx_power_w':20.,'tx_gain_dbi':12.,'rx_diameter_m':70.,'rx_efficiency':.55,'system_noise_k':30.,'other_losses_db':3.,'bitrate_bps':1000000.,'required_ebno_db':3.,'implementation_loss_db':2.,'reserve_margin_db':3.,'panel_area_m2':2.,'panel_efficiency':.28,'panel_derating':.7,'panel_mode':'tracking','panel_tilt_deg':0.,'panel_azimuth_deg':0.,'battery_wh':2000.,'initial_soc':.8,'minimum_soc':.2,'charge_efficiency':.9,'discharge_efficiency':.9,'base_load_w':60.,'active_load_w':120.,'footprint_m':20.,'slope_limit_deg':10.,'roughness_limit_m':.3,'vehicle':'rover','hop_dry_mass_kg':20.,'hop_propellant_kg':2.,'hop_isp_s':220.,'hop_speed_m_s':20.,'hop_angle_deg':45.}
LIMITS={'mast_m':(0.1,100),'height_uncertainty_m':(0,100),'horizon_range_km':(10,250),'horizon_step_deg':(.25,2),'station_mask_deg':(0,90),'frequency_ghz':(.1,100),'tx_power_w':(.001,100000),'tx_gain_dbi':(-20,100),'rx_diameter_m':(.1,100),'rx_efficiency':(.01,1),'system_noise_k':(1,100000),'other_losses_db':(0,100),'bitrate_bps':(1,1e10),'required_ebno_db':(-10,50),'implementation_loss_db':(0,30),'reserve_margin_db':(0,30),'panel_area_m2':(0,10000),'panel_efficiency':(0,1),'panel_derating':(0,1),'panel_tilt_deg':(0,180),'panel_azimuth_deg':(0,360),'battery_wh':(.1,1e8),'initial_soc':(0,1),'minimum_soc':(0,1),'charge_efficiency':(.01,1),'discharge_efficiency':(.01,1),'base_load_w':(0,1e6),'active_load_w':(0,1e6),'footprint_m':(10,200),'slope_limit_deg':(0,60),'roughness_limit_m':(0,100),'hop_dry_mass_kg':(.1,1e6),'hop_propellant_kg':(0,1e6),'hop_isp_s':(1,1000),'hop_speed_m_s':(0,100),'hop_angle_deg':(1,89)}

def normalize(config):
    result={**DEFAULTS,**(config or {})}
    for key,(low,high) in LIMITS.items():
        value=float(result[key])
        if not math.isfinite(value) or not low<=value<=high:raise ValueError(f'{key} must be in [{low},{high}]')
        result[key]=value
    if result['station'] not in STATIONS:raise ValueError('Unsupported station')
    if result['panel_mode'] not in ['tracking','fixed']:raise ValueError('Panel mode must be tracking or fixed')
    if result['vehicle'] not in ['rover','lander','hopper','crewed']:raise ValueError('Unsupported vehicle model')
    if not isinstance(result['enabled'],bool) or not isinstance(result['terrain'],bool):raise ValueError('Model switches must be boolean')
    if result['initial_soc']<result['minimum_soc']:raise ValueError('Initial battery state must be above the reserve floor')
    return result

def circle_overlap_fraction(a,b,d):
    """Area of circular Sun occulted by circular Earth; uniform angular disk approximation."""
    if a<=0 or b<=0:return 0.
    if d>=a+b:return 0.
    if d<=abs(a-b):return 1. if b>=a else (b/a)**2
    x=np.clip((d*d+a*a-b*b)/(2*d*a),-1,1);y=np.clip((d*d+b*b-a*a)/(2*d*b),-1,1)
    area=a*a*math.acos(float(x))+b*b*math.acos(float(y))-.5*math.sqrt(max(0,(-d+a+b)*(d+a-b)*(d-a+b)*(d+a+b)))
    return min(1.,max(0.,area/(math.pi*a*a)))

def eclipse(sun,earth):
    sv=np.asarray(sun['vector']);ev=np.asarray(earth['vector']);sep=math.degrees(math.acos(float(np.clip(np.dot(sv,ev)/(np.linalg.norm(sv)*np.linalg.norm(ev)),-1,1))))
    blocked=circle_overlap_fraction(sun['radius'],earth['radius'],sep) if np.linalg.norm(ev)<np.linalg.norm(sv) else 0.
    return {'state':'total' if blocked>=1-1e-10 else 'partial' if blocked>0 else 'none','unocculted_fraction':1-blocked,'separation_deg':sep,'external_contact_deg':sep-sun['radius']-earth['radius'],'internal_contact_deg':sep-abs(earth['radius']-sun['radius'])}

def disk_visible_fraction(elevation,radius,plane):
    c=elevation-plane
    if c>=radius:return 1.
    if c<=-radius:return 0.
    x=c/radius;return (math.acos(-x)+x*math.sqrt(max(0,1-x*x)))/math.pi

def disk_samples(body,profile,variant='elevation_deg',earth=None):
    if not profile.get('azimuth_deg'):return None
    # Area-uniform angular disk, deterministic 512 points; no atmospheric/limb-darkening correction.
    n=512;k=np.arange(n);radius=np.sqrt((k+.5)/n)*body['radius'];angle=k*math.pi*(3-math.sqrt(5));dx=radius*np.cos(angle);dy=radius*np.sin(angle);az=body['azimuth']+dx/max(.01,math.cos(math.radians(body['elevation'])));elev=body['elevation']+dy
    mask=[]
    for a,e in zip(az,elev):
        h=horizon_at(profile,float(a),variant)
        if h is None:return None
        mask.append(e>h)
    return float(np.mean(mask))

def rf_budget(distance_km,cfg):
    wavelength=C_KM_S/(cfg['frequency_ghz']*1e9);diameter_km=cfg['rx_diameter_m']/1000
    rx_gain=10*math.log10(cfg['rx_efficiency']*(math.pi*diameter_km/wavelength)**2)
    fspl=20*math.log10(4*math.pi*distance_km/wavelength);eirp=10*math.log10(cfg['tx_power_w'])+cfg['tx_gain_dbi'];received=eirp+rx_gain-fspl-cfg['other_losses_db'];noise=-228.599167+10*math.log10(cfg['system_noise_k']);cn0=received-noise;ebno=cn0-10*math.log10(cfg['bitrate_bps']);margin=ebno-cfg['required_ebno_db']-cfg['implementation_loss_db']-cfg['reserve_margin_db']
    return {'distance_km':distance_km,'free_space_loss_db':fspl,'eirp_dbw':eirp,'rx_gain_dbi':rx_gain,'received_power_dbw':received,'cn0_dbhz':cn0,'ebno_db':ebno,'nominal_margin_db':margin,'propagation_delay_s':distance_km/C_KM_S,'model':'one-way isotropic free-space downlink with user losses; no interference/weather/pointing pattern model'}

def observer_basis(lat,lon,height):
    phi=math.radians(lat);lam=math.radians(lon);up=np.array([math.cos(phi)*math.cos(lam),math.cos(phi)*math.sin(lam),math.sin(phi)]);east=np.array([-math.sin(lam),math.cos(lam),0]);north=np.cross(up,east)
    return up*(R+height/1000),up,east,north

def body_at(target,et,observer,up,east,north):
    state,_=sp.spkcpo(target,et,'MOON_ME','OBSERVER','LT+S',observer,'MOON','MOON_ME');v=state[:3];distance=np.linalg.norm(v);radius=695700 if target=='SUN' else 6378.137
    return {'azimuth':math.degrees(math.atan2(float(v@east),float(v@north)))%360,'elevation':math.degrees(math.asin(float(np.clip(v@up/distance,-1,1)))),'radius':math.degrees(math.asin(radius/distance)),'vector':list(map(float,v))}

def station_at(et,observer,up,east,north,cfg,profile):
    station=STATIONS[cfg['station']];st,_=sp.spkpos(station['id'],et,'ITRF93','NONE','EARTH')
    state,lt=sp.spkcpo(station['id'],et,'MOON_ME','OBSERVER','LT+S',observer,'MOON','MOON_ME');v=state[:3];distance=float(np.linalg.norm(v));elevation=math.degrees(math.asin(float(np.clip(v@up/distance,-1,1))));azimuth=math.degrees(math.atan2(float(v@east),float(v@north)))%360
    moon,lt2=sp.spkcpo('MOON',et,'ITRF93','OBSERVER','LT+S',st,'EARTH','ITRF93');to_surface=moon[:3]+sp.mxv(sp.pxfrm2('MOON_ME','ITRF93',et-lt2,et),observer)
    slon,slat,_=sp.recgeo(st,6378.137,1/298.257223563);station_up=np.array([math.cos(slat)*math.cos(slon),math.cos(slat)*math.sin(slon),math.sin(slat)]);earth_elevation=math.degrees(math.asin(float(np.clip(to_surface@station_up/np.linalg.norm(to_surface),-1,1))))
    terrain_h=horizon_at(profile,azimuth) if cfg['terrain'] else 0.;terrain_access=None if terrain_h is None else elevation>terrain_h
    geometric=elevation>0 and earth_elevation>=cfg['station_mask_deg'];access=None if terrain_access is None and geometric else geometric and bool(terrain_access)
    return {'station':cfg['station'],'name':station['name'],'lunar_azimuth_deg':azimuth,'lunar_elevation_deg':elevation,'earth_station_elevation_deg':earth_elevation,'station_mask_deg':cfg['station_mask_deg'],'geometric_access':geometric,'terrain_access':terrain_access,'access':access,'clearance_margin_deg':min(elevation-(terrain_h if terrain_h is not None else 0),earth_elevation-cfg['station_mask_deg']),'rf':rf_budget(distance,cfg),'scheduling':'antenna availability, DSN allocations and operational masks not included'}

def refine_root(function,left,right,tolerance=1.):
    fl=function(left);fr=function(right)
    if not math.isfinite(fl) or not math.isfinite(fr) or fl*fr>0:return None
    for _ in range(64):
        if right-left<=tolerance:break
        middle=(left+right)/2;fm=function(middle)
        if fl*fm<=0:right=middle;fr=fm
        else:left=middle;fl=fm
    return {'et':(left+right)/2,'bracket_seconds':right-left,'direction':'positive-to-negative' if fl>=0 else 'negative-to-positive'}

def simulate_battery(rows,cfg,activities):
    nominal=cfg['initial_soc']*cfg['battery_wh'];conservative=nominal;minimum_nominal=nominal;minimum_conservative=nominal;unserved=0.;generated=0.;consumed=0.;output=[]
    def load_at(t):return cfg['base_load_w']+sum((0 if e.get('type')=='power' else cfg['active_load_w']) for e in activities if e.get('offset',0)<=t<e.get('offset',0)+e.get('duration',0))
    for i,row in enumerate(rows):
        output.append({**row,'load_w':load_at(row['elapsed']),'battery_nominal_wh':nominal,'battery_conservative_wh':conservative,'soc_nominal':nominal/cfg['battery_wh'],'soc_conservative':conservative/cfg['battery_wh']})
        if i==len(rows)-1:break
        left=row['elapsed'];right=rows[i+1]['elapsed'];edges=sorted(set([left,right]+[t for e in activities for t in [e.get('offset',0),e.get('offset',0)+e.get('duration',0)] if left<t<right]))
        for l,r in zip(edges,edges[1:]):
            dt=r-l;load=load_at((l+r)/2);generated+=row['power_nominal_w']*dt;consumed+=load*dt
            for name in ['nominal','conservative']:
                energy=nominal if name=='nominal' else conservative;power=row['power_nominal_w'] if name=='nominal' else row['power_lower_w'];net=power-load;delta=net*dt*cfg['charge_efficiency'] if net>=0 else net*dt/cfg['discharge_efficiency'];next_energy=energy+delta
                if name=='nominal':unserved+=max(0,-next_energy);nominal=min(cfg['battery_wh'],max(0,next_energy));minimum_nominal=min(minimum_nominal,nominal)
                else:conservative=min(cfg['battery_wh'],max(0,next_energy));minimum_conservative=min(minimum_conservative,conservative)
    return output,{'generated_nominal_wh':generated,'load_wh':consumed,'minimum_soc_nominal':minimum_nominal/cfg['battery_wh'],'minimum_soc_conservative':minimum_conservative/cfg['battery_wh'],'end_soc_nominal':nominal/cfg['battery_wh'],'reserve_floor':cfg['minimum_soc'],'nominal_unserved_wh':unserved,'nominal_reserve_pass':minimum_nominal/cfg['battery_wh']>=cfg['minimum_soc'],'conservative_reserve_pass':minimum_conservative/cfg['battery_wh']>=cfg['minimum_soc'],'model':'sampled constant-generation energy balance with exact activity start/end splitting; charge/discharge efficiency; no temperature, degradation, peak-current or detailed battery model'}

def hopper_screen(cfg):
    mass=cfg['hop_dry_mass_kg'];prop=cfg['hop_propellant_kg'];dv=cfg['hop_isp_s']*9.80665*math.log((mass+prop)/mass);v=cfg['hop_speed_m_s'];angle=math.radians(cfg['hop_angle_deg']);g=1.625
    return {'ideal_delta_v_m_s':dv,'ideal_ballistic_range_m':v*v*math.sin(2*angle)/g,'ideal_flight_time_s':2*v*math.sin(angle)/g,'ideal_apex_m':v*v*math.sin(angle)**2/(2*g),'two_impulse_delta_v_demand_m_s':2*v,'ideal_propellant_margin_m_s':dv-2*v,'scope':'vacuum, flat local surface, constant lunar gravity; impulsive launch/landing; no thrust limits, terrain avoidance, reserves or guidance; not a trajectory solution'}

def run_analysis(payload,result,profile):
    cfg=normalize(payload.get('analysis'));lat=float(payload['lat']);lon=float(payload['lon']);height=result['method'].get('observer_height_m',payload.get('height',0));observer,up,east,north=observer_basis(lat,lon,height)
    start=datetime.fromisoformat(payload['start'].replace('Z','+00:00'));et0=sp.str2et(start.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'));duration=float(payload['duration'])*3600
    @lru_cache(maxsize=5000)
    def evaluate(seconds):
        et=sp.str2et((start+timedelta(seconds=seconds)).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'));sun=body_at('SUN',et,observer,up,east,north);earth=body_at('EARTH',et,observer,up,east,north);ecl=eclipse(sun,earth);station=station_at(et,observer,up,east,north,cfg,profile)
        h=horizon_at(profile,sun['azimuth']) if cfg['terrain'] else 0.;clearance=None if h is None else sun['elevation']-h
        return {'sun':sun,'earth':earth,'eclipse':ecl,'station':station,'clearance':clearance}
    rows=[]
    for raw in result['rows']:
        seconds=raw['elapsed']*3600;state=evaluate(seconds);sun=state['sun'];ecl=state['eclipse'];nominal=disk_samples(sun,profile) if cfg['terrain'] else disk_visible_fraction(sun['elevation'],sun['radius'],0.)
        lower=disk_samples(sun,profile,'upper_deg') if cfg['terrain'] else nominal;upper=disk_samples(sun,profile,'lower_deg') if cfg['terrain'] else nominal
        unknown=nominal is None
        if unknown:nominal=disk_visible_fraction(sun['elevation'],sun['radius'],0.);lower=0.;upper=1.
        # For overlapping Earth/terrain masks use rigorous intersection bounds; product is only a nominal independence estimate.
        direct=nominal*ecl['unocculted_fraction'];direct_low=max(0,float(lower)+ecl['unocculted_fraction']-1);direct_high=min(float(upper),ecl['unocculted_fraction'])
        if cfg['panel_mode']=='tracking':incidence=1.
        else:incidence=max(0,math.sin(math.radians(sun['elevation']))*math.cos(math.radians(cfg['panel_tilt_deg']))+math.cos(math.radians(sun['elevation']))*math.sin(math.radians(cfg['panel_tilt_deg']))*math.cos(math.radians(sun['azimuth']-cfg['panel_azimuth_deg'])))
        base=1361*(AU_KM/np.linalg.norm(sun['vector']))**2*cfg['panel_area_m2']*cfg['panel_efficiency']*cfg['panel_derating']*incidence
        rows.append({'time':raw['time'],'elapsed':raw['elapsed'],'eclipse':ecl,'solar_fraction_nominal':direct,'solar_fraction_lower':direct_low,'solar_fraction_upper':direct_high,'terrain_fraction':None if unknown else nominal,'terrain_unknown':unknown,'station':state['station'],'power_nominal_w':float(base*direct),'power_lower_w':float(base*direct_low),'power_upper_w':float(base*direct_high)})
    activities=payload.get('activities',[])
    if not isinstance(activities,list) or len(activities)>1000:raise ValueError('At most 1000 activities supported')
    for activity in activities:
        if not isinstance(activity,dict) or not all(math.isfinite(float(activity.get(k,0))) for k in ['offset','duration']):raise ValueError('Invalid mission activity')
        if float(activity.get('offset',0))<0 or float(activity.get('duration',0))<0 or (float(activity.get('offset',0))+float(activity.get('duration',0)))*3600>duration+1e-4:raise ValueError('Activity exceeds mission interval')
    rows,power=simulate_battery(rows,cfg,activities)
    search_step=max(120,math.ceil(duration/4096));times=list(np.arange(0,duration,search_step))+[duration];search=[evaluate(float(t)) for t in times]
    functions={'sun-limb':lambda v: v['clearance']+v['sun']['radius'] if v['clearance'] is not None else math.nan,'sun-full-disk':lambda v:v['clearance']-v['sun']['radius'] if v['clearance'] is not None else math.nan,'eclipse-external-contact':lambda v:v['eclipse']['external_contact_deg'],'eclipse-total-contact':lambda v:v['eclipse']['internal_contact_deg'],'station-access':lambda v:v['station']['clearance_margin_deg'] if v['station']['terrain_access'] is not None else math.nan}
    events=[]
    for kind,function in functions.items():
        for i in range(len(times)-1):
            left=function(search[i]);right=function(search[i+1])
            if math.isfinite(left) and math.isfinite(right) and left*right<0:
                root=refine_root(lambda t:function(evaluate(t)),float(times[i]),float(times[i+1]))
                if root:
                    dt=start+timedelta(seconds=root['et']);events.append({'kind':kind,'time':dt.isoformat().replace('+00:00','Z'),'elapsed_hours':root['et']/3600,'bracket_seconds':root['bracket_seconds'],'direction':root['direction'],'terrain_dependent':kind.startswith('sun') or kind=='station-access'})
    access_hours=sum((rows[i+1]['elapsed']-r['elapsed']) for i,r in enumerate(rows[:-1]) if r['station']['access'] is True);unknown_hours=sum((rows[i+1]['elapsed']-r['elapsed']) for i,r in enumerate(rows[:-1]) if r['station']['access'] is None);eclipse_hours=sum((rows[i+1]['elapsed']-r['elapsed']) for i,r in enumerate(rows[:-1]) if r['eclipse']['state']!='none')
    # Rank contiguous sample-aligned candidate windows. No fabricated global optimum or operational clearance.
    candidates=[]
    for event in activities[:20]:
        length=float(event.get('duration',0));ranked=[]
        for i in range(0,len(rows)-1,max(1,math.ceil(len(rows)/64))):
            r=rows[i]
            if r['elapsed']+length>float(payload['duration']):continue
            segment=[x for x in rows if r['elapsed']<=x['elapsed']<=r['elapsed']+length]
            if not segment:continue
            contact=all(x['station']['access'] is True and x['station']['rf']['nominal_margin_db']>=0 for x in segment);unknown=any(x['terrain_unknown'] or x['station']['access'] is None for x in segment)
            proposed=[{**x,'offset':r['elapsed']} if x.get('id')==event.get('id') else x for x in activities]
            _,projected=simulate_battery(rows,cfg,proposed)
            reserve=projected['conservative_reserve_pass']
            if not reserve or unknown or (event.get('type')=='communication' and not contact):continue
            score=projected['minimum_soc_conservative']+sum(x['solar_fraction_lower'] for x in segment)/len(segment)
            ranked.append({'start_offset_hours':r['elapsed'],'start_utc':r['time'],'score':score,'minimum_projected_soc':projected['minimum_soc_conservative'],'contact_at_samples':contact,'duration_hours':length})
        ranked.sort(key=lambda x:x['score'],reverse=True);candidates.append({'activity_id':event.get('id'),'activity_name':event.get('name'),'windows':ranked[:3],'status':'candidate-windows' if ranked else 'no-screened-window','method':'bounded single-activity time-shift search (up to 64 starts, first 20 activities), with complete sampled battery recomputation per candidate; candidates are not a jointly optimized schedule; overlaps and hardware contention need review'})
    return {'version':'research-analysis-v1','qualification':'research-screening; independent mission validation required','inputs':cfg,'terrain':profile,'rows':rows,'events':sorted(events,key=lambda e:e['elapsed_hours']),'power':power,'access':{'station':cfg['station'],'available_hours_at_samples':access_hours,'unknown_terrain_hours':unknown_hours,'eclipse_hours_at_samples':eclipse_hours,'rf_is_nominal':True,'dsn_reservation':False},'landing':safety_screen(lat,lon,cfg['footprint_m'],cfg['slope_limit_deg'],cfg['roughness_limit_m']),'hopper':hopper_screen(cfg) if cfg['vehicle']=='hopper' else None,'candidate_windows':candidates,'events_method':{'search_step_seconds':search_step,'root_bracket_tolerance_seconds':1,'complete_event_search':False,'limitation':'Sign-change brackets only; sub-step events and grazing contacts may be missed. Bracket tolerance is not physical timing accuracy.'},'earth_orientation':{'frame':'ITRF93','historical_and_predict_kernel':'earth_1962_260806_2126_combined.bpc','short_term_override':'earth_000101_270204_261109.bpc','last_short_term_datum_utc':'2026-11-14','long_predict_warning':'Outside the daily-kernel coverage, long-term predicted Earth orientation has lower accuracy; current station operations are not represented.'},'limitations':['No mission approval, flight certification or astronaut safety clearance','No terrain displacement in the global map','No thermal battery degradation, regolith dynamics, plume, radiation or landing guidance','RF and power hardware inputs are user assumptions, not NASA spacecraft specifications','Eclipse: spherical Earth and uniform solar disk; excludes atmospheric refraction and limb darkening','Station geometry does not reserve DSN time or include actual azimuth-dependent station masks']}


def spacecraft_solar_fraction(et,spacecraft):
    sun,_=sp.spkpos('SUN',et,'J2000','LT+S',spacecraft);unit=sun/np.linalg.norm(sun);solar_radius=math.asin(695700/np.linalg.norm(sun));east=np.cross([0,0,1],unit);east=east/np.linalg.norm(east);north=np.cross(unit,east)
    n=512;k=np.arange(n);r=np.sqrt((k+.5)/n)*solar_radius;phase=k*math.pi*(3-math.sqrt(5));x=r*np.cos(phase);y=r*np.sin(phase);blocked=np.zeros(n,dtype=bool);states=[]
    for target,radius in [('EARTH',6378.137),('MOON',1737.4)]:
        v,_=sp.spkpos(target,et,'J2000','LT+S',spacecraft);distance=np.linalg.norm(v);angle=math.acos(float(np.clip(np.dot(unit,v)/distance,-1,1)));body_radius=math.asin(radius/distance)
        if angle>=body_radius+solar_radius:continue
        tangent=np.array([np.dot(v,east),np.dot(v,north)]);norm=np.linalg.norm(tangent);offset=tangent/norm*angle if norm>0 else np.zeros(2);mask=(x-offset[0])**2+(y-offset[1])**2<body_radius**2;blocked|=mask
        if mask.any():states.append('Earth eclipse' if target=='EARTH' else 'Moon occultation')
    return {'solar_unocculted_fraction':float(1-blocked.mean()),'solar_state':' + '.join(states) or 'sunlit','solar_model':'512 uniform angular-disk rays; spherical Earth/Moon; no atmospheric refraction or limb darkening','ephemeris_source':'lrorg_2022258_2022349_v01.bsp (FDF/GSFC ACTUAL product)'}
