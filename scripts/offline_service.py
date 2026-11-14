"""Persistent, bounded NASA imagery cache with explicit downloadable coverage packs."""
from pathlib import Path
from datetime import datetime,timezone
import concurrent.futures,hashlib,io,json,math,re,shutil,sqlite3,threading,time,uuid
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];CACHE=ROOT/'work/tiles';CACHE.mkdir(parents=True,exist_ok=True)
LAYERS={'imagery':('LRO_WAC_Mosaic_Global_303ppd_v02','jpg',8),'elevation':('LRO_LOLA_ClrShade_Global_256ppd_v06','png',6),'hillshade':('LRO_LOLA_Shade_Global_128ppd_v04','png',5),'slope':('LRO_LOLA_ClrSlope_Global_16ppd','png',2)}
JOBS={};OFFLINE=False;FALLBACKS=0;FETCH_LOCKS={};LOCK=threading.RLock()
DB=ROOT/'work/tiles.sqlite'
SESSIONS=threading.local()
def session():
 # Each download worker owns its connection pool. Retry only transient failures;
 # absent tiles (404) must remain visible as incomplete coverage.
 if not hasattr(SESSIONS,'http'):
  http=requests.Session()
  http.headers['User-Agent']='LUNA-local-research/1.0'
  http.mount('https://',HTTPAdapter(max_retries=Retry(total=3,backoff_factor=.8,status_forcelist=[429,500,502,503,504],allowed_methods=['GET'],respect_retry_after_header=True)))
  SESSIONS.http=http
 return SESSIONS.http

def save_job(job):
 job['updated_utc']=datetime.now(timezone.utc).isoformat()
 path=CACHE/('pack-'+job['id']+'.json');tmp=path.with_suffix('.tmp')
 tmp.write_text(json.dumps({**job,'source':'https://trek.nasa.gov/tiles/Moon/EQ/'},indent=2));tmp.replace(path)

def load_jobs():
 for path in CACHE.glob('pack-*.json'):
  try:
   job=json.loads(path.read_text())
   if path.name!='pack-'+job['id']+'.json':continue
   if job['status'] in ['starting','running']:
    job.update(status='interrupted',cancel=False,message='Server restarted. Resume to verify coverage and download missing tiles.');save_job(job)
   JOBS[job['id']]=job
  except (OSError,ValueError,KeyError,TypeError):continue
load_jobs()
def database():
 db=sqlite3.connect(DB,timeout=20);db.execute('PRAGMA journal_mode=WAL');return db
with database() as db:db.execute('CREATE TABLE IF NOT EXISTS tiles(layer TEXT,z INTEGER,y INTEGER,x INTEGER,bytes INTEGER,sha256 TEXT,downloaded TEXT,PRIMARY KEY(layer,z,y,x))')
try:OFFLINE=bool(json.loads((ROOT/'work/offline-config.json').read_text()).get('offline'))
except Exception:pass

def tile_key(layer,z,y,x):
 if layer not in LAYERS or not all(isinstance(v,int) for v in [z,y,x]) or not 0<=z<=LAYERS[layer][2] or not 0<=y<2**z or not 0<=x<2**(z+1):raise ValueError('Invalid lunar tile coordinate')
 return CACHE/layer/str(z)/str(y)/(str(x)+'.'+LAYERS[layer][1])

def get_tile(layer,z,y,x,fetch=True):
 path=tile_key(layer,z,y,x)
 if path.exists():return path.read_bytes()
 if not fetch or OFFLINE:raise FileNotFoundError('Tile is not downloaded')
 key=(layer,z,y,x)
 with LOCK:lock=FETCH_LOCKS.setdefault(key,threading.Lock())
 with lock:
  if path.exists():return path.read_bytes()
  source,ext,_=LAYERS[layer];url=f'https://trek.nasa.gov/tiles/Moon/EQ/{source}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}'
  response=session().get(url,timeout=(8,30));response.raise_for_status();data=response.content
  if len(data)>5*1024*1024:raise ValueError('Unexpected tile size')
  with Image.open(io.BytesIO(data)) as im:
   im.verify()
  path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.'+uuid.uuid4().hex+'.tmp');tmp.write_bytes(data);tmp.replace(path)
  with database() as db:db.execute('INSERT OR REPLACE INTO tiles VALUES(?,?,?,?,?,?,?)',(layer,z,y,x,len(data),hashlib.sha256(data).hexdigest(),datetime.now(timezone.utc).isoformat()))
  return data

def fallback(layer,z,y,x):
 global FALLBACKS
 for parent in range(z-1,-1,-1):
  factor=2**(z-parent);path=tile_key(layer,parent,y//factor,x//factor)
  if path.exists():
   with Image.open(path) as im:
    width,height=im.size;px=x%factor;py=y%factor;im=im.crop((px*width/factor,py*height/factor,(px+1)*width/factor,(py+1)*height/factor)).resize((width,height),Image.Resampling.BILINEAR);out=io.BytesIO();im.convert('RGB').save(out,format='JPEG',quality=90)
   FALLBACKS+=1;return out.getvalue()
 raise FileNotFoundError('No tile or cached ancestor for this area')

def serve_tile(path):
 match=re.fullmatch(r'/api/tiles/(imagery|elevation|hillshade|slope)/(\d+)/(\d+)/(\d+)\.(jpg|png)',path)
 if not match:return None
 layer=match[1];z,y,x=map(int,match.group(2,3,4));tile_key(layer,z,y,x)
 try:return (200,get_tile(layer,z,y,x),'image/jpeg' if LAYERS[layer][1]=='jpg' else 'image/png',{'X-Luna-Resolution':'native tile level '+str(z)})
 except Exception:
  try:return (200,fallback(layer,z,y,x),'image/jpeg',{'X-Luna-Resolution':'UPSCALED CACHED ANCESTOR - lower detail'})
  except FileNotFoundError:return (404,b'Tile unavailable. Download this region before going offline.','text/plain',{})

def tiles_for(layer,level,bbox):
 if layer not in LAYERS or not isinstance(level,int) or not 0<=level<=LAYERS[layer][2]:raise ValueError('Unsupported layer or native zoom level')
 west,south,east,north=map(float,bbox)
 if not all(map(math.isfinite,[west,south,east,north])) or not(-180<=west<east<=180 and -90<=south<north<=90):raise ValueError('Bounds must be [west,south,east,north], without antimeridian crossing')
 for z in range(level+1):
  nx=2**(z+1);ny=2**z;x0=max(0,min(nx-1,int((west+180)/360*nx)));x1=max(0,min(nx-1,int(math.ceil((east+180)/360*nx)-1)));y0=max(0,min(ny-1,int((90-north)/180*ny)));y1=max(0,min(ny-1,int(math.ceil((90-south)/180*ny)-1)))
  for y in range(y0,y1+1):
   for x in range(x0,x1+1):yield (layer,z,y,x)

def start_pack(payload):
 if OFFLINE:raise ValueError('Turn forced offline mode off before downloading new imagery')
 layer=payload.get('layer','imagery');level=int(payload.get('level',3));bbox=payload.get('bbox',[-180,-90,180,90]);items=list(tiles_for(layer,level,bbox))
 if len(items)>200000:raise ValueError('Pack exceeds the 200000-tile limit')
 estimate=len(items)*40000
 if shutil.disk_usage(CACHE).free<estimate+200*1024**2:raise ValueError('Insufficient free disk for the conservative pack estimate')
 with LOCK:
  if any(j['status'] in ['starting','running'] for j in JOBS.values()):raise ValueError('A map download is already running; finish or cancel it first')
  job_id=payload.get('resume') or uuid.uuid4().hex
  if not re.fullmatch('[a-f0-9]{32}',job_id):raise ValueError('Invalid pack identifier')
  job={'id':job_id,'status':'starting','done':0,'total':len(items),'failed':0,'layer':layer,'level':level,'bbox':bbox,'estimated_bytes':estimate,'message':'Preparing map pack; cached tiles will be reused','cancel':False};save_job(job);JOBS[job_id]=job
 def work():
  job['status']='running'
  def fetch(item):
   if job['cancel']:return False
   try:get_tile(*item);return True
   except Exception:return False
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for start in range(0,len(items),32):
     if job['cancel']:break
     for ok in pool.map(fetch,items[start:start+32]):job['done']+=1;job['failed']+=int(not ok)
     job['message']=f"{job['done']} / {job['total']} tiles; {job['failed']} failures"
     save_job(job)
   job['status']='cancelled' if job['cancel'] else 'complete' if job['failed']==0 else 'incomplete'
   job['message']='Pack complete with native tiles' if job['status']=='complete' else 'Pack is not complete; existing cached tiles are retained'
   save_job(job)
  except Exception:job.update(status='error',message='Download failed; existing cached tiles are retained')
  finally:save_job(job)
 threading.Thread(target=work,daemon=True).start();return {'job':job_id,'tiles':len(items),'estimated_bytes':estimate}

def status():
 with database() as db:
  rows=db.execute('SELECT layer,z,COUNT(*),SUM(bytes) FROM tiles GROUP BY layer,z').fetchall()
 packs=[]
 for path in sorted(CACHE.glob('pack-*.json'))[-20:]:
  try:packs.append(json.loads(path.read_text()))
  except Exception:pass
 return {'offline':OFFLINE,'tiles':sum(r[2] for r in rows),'bytes':sum(r[3] for r in rows),'layers':[{'layer':r[0],'level':r[1],'tiles':r[2],'bytes':r[3]} for r in rows],'jobs':sorted(JOBS.values(),key=lambda j:(j['status'] in ['starting','running'],j.get('updated_utc','')))[-20:],'packs':packs,'ancestor_fallbacks':FALLBACKS,'disk_free_bytes':shutil.disk_usage(CACHE).free,'note':'Only complete pack bounds and levels have guaranteed native offline detail. Interrupted downloads can be resumed; cached tiles are reused. Missing high-resolution tiles use lower-detail cached ancestors. Local server must stay running.'}

def handle_post(path,payload):
 global OFFLINE
 if path=='/api/offline/download':return start_pack(payload)
 if path=='/api/offline/resume':
  job=JOBS.get(payload.get('job'))
  if not job:raise ValueError('Download pack not found')
  if job['status']=='complete':raise ValueError('This pack is already complete')
  return start_pack({'layer':job['layer'],'level':job['level'],'bbox':job['bbox'],'resume':job['id']})
 if path=='/api/offline/config':
  if not isinstance(payload.get('offline'),bool):raise ValueError('Offline setting must be boolean')
  if payload['offline']:
   with LOCK:
    for job in JOBS.values():
     if job['status'] in ['starting','running']:job['cancel']=True
  OFFLINE=payload['offline'];(ROOT/'work/offline-config.json').write_text(json.dumps({'offline':OFFLINE}));return {'offline':OFFLINE}
 if path=='/api/offline/cancel':
  job=JOBS.get(payload.get('job'))
  if job:job['cancel']=True
  return {'ok':True}
 return None
