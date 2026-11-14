"""Local lunar geometry API. NASA SPICE, MOON_ME/DE421 orientation + DE440 translations."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from datetime import datetime, timezone, timedelta
import json, math, hashlib, threading
from functools import lru_cache
import numpy as np
import spiceypy as sp
import requests

GEOMETRY_LOCK=threading.RLock()
ROOT = Path(__file__).resolve().parents[1]
KERNELS = ['naif0012.tls','pck00011.tpc','de440s.bsp','moon_pa_de421_1900-2050.bpc','moon_080317.tf']
RADIUS = 1737.4
MU = 4902.800066
SCIENCE_KERNELS=['earth_1962_260806_2126_combined.bpc','earth_000101_270204_261109.bpc','earthstns_itrf93_260814.bsp','earth_topo_260814.tf']

def load_kernels():
    for name in KERNELS: sp.furnsh(str(ROOT/'work/kernels'/name))
    if (ROOT/'work/kernels/lrorg_2022258_2022349_v01.bsp').exists():sp.furnsh(str(ROOT/'work/kernels/lrorg_2022258_2022349_v01.bsp'))
    for name in SCIENCE_KERNELS:
        if (ROOT/'work/kernels'/name).exists():sp.furnsh(str(ROOT/'work/kernels'/name))

def finite(value, minimum, maximum):
    number = float(value)
    if not math.isfinite(number) or not minimum <= number <= maximum: raise ValueError(f'Value must be between {minimum} and {maximum}')
    return number

def calculate(payload):
    lat = finite(payload.get('lat', -89.5), -90, 90)
    lon = finite(payload.get('lon', 0), -180, 180)
    height = finite(payload.get('height', 0), -10000, 100000)
    duration = finite(payload.get('duration', 24), 1/60, 744)
    start = datetime.fromisoformat(payload['start'].replace('Z','+00:00'))
    if start.tzinfo is None: raise ValueError('UTC timezone is required')
    if not (1969 <= start.year <= 2049) or (start+timedelta(hours=duration)).year > 2049: raise ValueError('Supported dates: 1969-01-01 through 2049-12-31')
    step = max(60, int(finite(payload.get('step',900),60,86400)))
    count = math.ceil(duration*3600/step)
    if count > 1500: step = math.ceil(duration*3600/1500);count=math.ceil(duration*3600/step)
    profile={'status':'disabled','complete':False,'azimuth_deg':[],'elevation_deg':[],'reason':'Ideal reference-plane mode selected.'}
    from mission_models import normalize
    model_cfg=normalize(payload.get('analysis'))
    if model_cfg['enabled']:
        missing=[name for name in SCIENCE_KERNELS if not (ROOT/'work/kernels'/name).exists()]
        if missing:raise ValueError('Science kernels missing. Run npm run setup:science in app/.')
        if model_cfg['terrain']:
            from terrain_model import horizon
            profile=horizon(lat,lon,model_cfg['mast_m'],model_cfg['height_uncertainty_m'],model_cfg['horizon_range_km'],model_cfg['horizon_step_deg'])
            if profile.get('observer_height_m') is not None:height=profile['observer_height_m']
    phi,lam = math.radians(lat), math.radians(lon)
    up=np.array([math.cos(phi)*math.cos(lam),math.cos(phi)*math.sin(lam),math.sin(phi)])
    east=np.array([-math.sin(lam),math.cos(lam),0]);north=np.cross(up,east)
    observer=up*(RADIUS+height/1000)
    satellites=payload.get('satellites',[])
    if not isinstance(satellites,list) or len(satellites)>12: raise ValueError('At most 12 planning satellites are supported')
    normalized=[]
    for sat in satellites:
        if sat.get('ephemeris') not in [None,'LRO-2022']:raise ValueError('Unsupported spacecraft ephemeris source')
        if sat.get('ephemeris')=='LRO-2022':
            if not (ROOT/'work/kernels/lrorg_2022258_2022349_v01.bsp').exists():raise ValueError('LRO definitive kernel missing; run npm run setup:science')
            if start<datetime(2022,9,15,tzinfo=timezone.utc) or start+timedelta(hours=duration)>datetime(2022,12,15,tzinfo=timezone.utc):raise ValueError('LRO definitive trajectory covers 2022-09-15 through 2022-12-15 only. No circular fallback is substituted.')
        normalized.append(dict(id=str(sat['id'])[:100],ephemeris=sat.get('ephemeris'), altitude=finite(sat['altitude'],10,100000), inclination=finite(sat['inclination'],0,180), raan=finite(sat['raan'],0,360), phase=finite(sat['phase'],0,360)))
    def satellite_position(sat, seconds, et):
        if sat.get('ephemeris')=='LRO-2022':return sp.spkpos('-85',et,'MOON_ME','NONE','MOON')[0]
        a=RADIUS+sat['altitude'];u=math.radians(sat['phase'])+math.sqrt(MU/a**3)*seconds
        inc=math.radians(sat['inclination']);omega=math.radians(sat['raan'])
        v=np.array([a*(math.cos(omega)*math.cos(u)-math.sin(omega)*math.sin(u)*math.cos(inc)),a*(math.sin(omega)*math.cos(u)+math.cos(omega)*math.sin(u)*math.cos(inc)),a*math.sin(u)*math.sin(inc)])
        return sp.mxv(sp.pxform('J2000','MOON_ME',et),v)
    rows=[]
    for i in range(count+1):
        seconds=min(i*step,duration*3600);dt=start+timedelta(seconds=seconds);et=sp.str2et(dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'))
        row={'time':dt.isoformat().replace('+00:00','Z'),'elapsed':seconds/3600,'satellites':{}}
        for body,radius in [('sun',695700),('earth',6378.137)]:
            state,_=sp.spkcpo(body.upper(),et,'MOON_ME','OBSERVER','LT+S',observer,'MOON','MOON_ME')
            v=state[:3];distance=np.linalg.norm(v)
            row[body]={'azimuth':math.degrees(math.atan2(float(np.dot(v,east)),float(np.dot(v,north))))%360,'elevation':math.degrees(math.asin(float(np.dot(v,up))/distance)),'radius':math.degrees(math.asin(radius/distance)),'vector':list(map(float,v))}
        for sat in normalized:
            v=satellite_position(sat,seconds,et);relative=v-observer;above=float(np.dot(relative,up))>0
            row['satellites'][sat['id']]={'position':list(map(float,v)),'elevation':math.degrees(math.asin(float(np.dot(relative,up))/np.linalg.norm(relative))),'above_reference':above,'model':'NASA LRO definitive SPK' if sat.get('ephemeris') else 'circular two-body'}
            if sat.get('ephemeris')=='LRO-2022':
                from mission_models import spacecraft_solar_fraction
                row['satellites'][sat['id']].update(spacecraft_solar_fraction(et,'-85'))
        rows.append(row)
    et0=sp.str2et(start.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f'));orbits={}
    for sat in normalized:
        if sat.get('ephemeris')=='LRO-2022':
            orbits[sat['id']]={'period_seconds':None,'source':'NASA LRO definitive trajectory','positions':[list(map(float,satellite_position(sat,duration*3600*j/120,et0+duration*3600*j/120))) for j in range(121)]}
            continue
        period=2*math.pi*math.sqrt((RADIUS+sat['altitude'])**3/MU)
        orbits[sat['id']]={'period_seconds':period,'positions':[list(map(float,satellite_position(sat,period*j/120,et0+period*j/120))) for j in range(121)]}
    result= {'rows':rows,'orbits':orbits,'input':payload,'method':{'version':'spice-local-v2','observer_height_m':height,'observer_height_source':'DEM ground + mast' if model_cfg['enabled'] and profile.get('observer_height_m') is not None else 'user reference-sphere height','frame':'MOON_ME (DE421)','translation':'DE440s','aberration':'LT+S','radius_km':RADIUS,'step_seconds':step,'horizon':'ideal local 0 degree plane; terrain unavailable','orbit_model':'Per-spacecraft source: user circular two-body J2000, or NASA LRO definitive SPK; no live telemetry','limitations':['Body-center angles use reference plane. Optional mission analysis contains terrain/eclipse/station/RF/power estimates; no flight qualification or maneuver solution','DE440 translations and DE421 lunar orientation; no flight certification']},'kernels':KERNELS,'kernel_provenance':json.loads((ROOT/'work/kernels/manifest.json').read_text()) if (ROOT/'work/kernels/manifest.json').exists() else []}

    if model_cfg['enabled']:
        from mission_models import run_analysis
        result['analysis']=run_analysis(payload,result,profile)
        manifest_path=ROOT/'work/science-manifest.json'
        result['analysis']['source_manifest']=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'sources':[]}
        result['analysis']['model_code_sha256']={name:hashlib.sha256((ROOT/'scripts'/name).read_bytes()).hexdigest() for name in ['geometry_server.py','mission_models.py','terrain_model.py']}
        result['kernels']=KERNELS+SCIENCE_KERNELS+(['lrorg_2022258_2022349_v01.bsp'] if any(sat.get('ephemeris')=='LRO-2022' for sat in normalized) else [])
    return result

@lru_cache(maxsize=8)
def cached_calculation(raw):
    return calculate(json.loads(raw))

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/terrain/'):
            try:
                from visual_terrain import tile
                level,x,y = map(int,self.path.removeprefix('/api/terrain/').removesuffix('.bin').split('/'))
                body=tile(level,x,y)
                self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','public, max-age=86400');self.end_headers();self.wfile.write(body)
            except (BrokenPipeError,ConnectionResetError): pass
            except Exception as error: self.respond(400,{'error':str(error)[:300]})
            return
        if self.path.startswith('/api/tiles/'):
            from offline_service import serve_tile
            try:
                tile=serve_tile(self.path)
                if tile:
                    status,body,mime,headers=tile;self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','public, max-age=86400' if status==200 else 'no-store')
                    for key,value in headers.items():self.send_header(key,value)
                    self.end_headers();self.wfile.write(body);return
            except (BrokenPipeError,ConnectionResetError):return
            except Exception:return self.respond(400,{'error':'Invalid map tile'})
        if self.path=='/api/offline/status':
            from offline_service import status
            return self.respond(200,status())
        if self.path.startswith('/api/ai/'):
            from ai_service import handle_get
            try:
                value=handle_get(self.path)
                return self.respond(200 if value is not None else 404,value or {'error':'Not found'})
            except Exception:return self.respond(400,{'error':'AI status unavailable'})
        self.respond(200,{'ok':True,'service':'Lunar Window local SPICE','frame':'MOON_ME/DE421','kernels':KERNELS,'kernel_provenance':json.loads((ROOT/'work/kernels/manifest.json').read_text()) if (ROOT/'work/kernels/manifest.json').exists() else []})
    def do_POST(self):
        if self.path not in ['/api/geometry','/api/recommendations','/api/routes'] and not self.path.startswith(('/api/ai/','/api/offline/')): return self.respond(404,{'error':'Unknown endpoint'})
        try:
            if self.headers.get('Origin') and self.headers.get('Origin') not in ['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173']:raise ValueError('Untrusted request origin')
            if not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError('JSON content type is required')
            size=int(self.headers.get('Content-Length',0))
            if size<1 or size>(12000000 if self.path.startswith("/api/ai/") else 500000): raise ValueError('Invalid request size')
            payload=json.loads(self.rfile.read(size))
            if self.path.startswith('/api/offline/'):
                from offline_service import handle_post
                data=handle_post(self.path,payload)
                return self.respond(200 if data is not None else 404,data or {'error':'Unknown offline endpoint'})
            if self.path.startswith('/api/ai/'):
                from ai_service import handle_post
                try:
                    data=handle_post(self.path,payload)
                    return self.respond(200 if data is not None else 404,data or {'error':'Unknown AI endpoint'})
                except requests.exceptions.RequestException: return self.respond(400,{'error':'AI provider could not be reached. Check the connection or local runtime.'})
            if self.path=='/api/routes':
                from surface_routes import plan_route
                return self.respond(200,plan_route(payload))
            if self.path=='/api/recommendations':
                from site_recommendations import recommend
                with GEOMETRY_LOCK:return self.respond(200,recommend(payload))
            with GEOMETRY_LOCK:self.respond(200,cached_calculation(json.dumps(payload,sort_keys=True)))
        except Exception as error:
            self.respond(400,{'error':str(error)[:300]})
    def respond(self,status,payload):
        body=json.dumps(payload,allow_nan=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();
        try: self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError): pass
    def log_message(self,*args): pass

if __name__=='__main__':
    load_kernels()
    print('Lunar geometry ready at http://127.0.0.1:8765',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
