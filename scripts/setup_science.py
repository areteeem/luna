"""Reproducible, bounded acquisition of official research model inputs."""
from pathlib import Path
import urllib.request, hashlib, json, shutil
ROOT=Path(__file__).resolve().parents[1]
FILES=[
 ('work/kernels/lrorg_2022258_2022349_v01.bsp','https://naif.jpl.nasa.gov/pub/naif/pds/data/lro-l-spice-6-v1.0/lrosp_1000/data/spk/lrorg_2022258_2022349_v01.bsp',12),
 ('work/kernels/earth_1962_260806_2126_combined.bpc','https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_1962_260806_2126_combined.bpc',40),
 ('work/kernels/earth_000101_270204_261109.bpc','https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/earth_000101_270204_261109.bpc',8),
 ('work/kernels/earthstns_itrf93_260814.bsp','https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/stations/earthstns_itrf93_260814.bsp',1),
 ('work/kernels/earth_topo_260814.tf','https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/stations/earth_topo_260814.tf',1),
 ('work/terrain/site04.tif','https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_surf.tif',50),
 ('work/terrain/lola80s.tif','https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF',200)]
records=[]
for relative,url,cap in FILES:
 dest=ROOT/relative;dest.parent.mkdir(parents=True,exist_ok=True)
 if not dest.exists() and (retained:=ROOT/'data/naif'/dest.name).is_file():
  contents=retained.read_bytes()
  expected='7369bae21e0103d5f79ccee5a87874effc2e497ea3064d9d5d69c069cf74d1c5'
  if hashlib.sha256(contents).hexdigest()!=expected:raise ValueError('Retained NAIF kernel failed checksum')
  dest.write_bytes(contents)
 if not dest.exists():
  print('Acquiring',dest.name,flush=True)
  tmp=dest.with_suffix('.download')
  with urllib.request.urlopen(url,timeout=600) as response,tmp.open('wb') as stream:
   size=0
   while data:=response.read(1024*1024):
    size+=len(data)
    if size>cap*1024*1024:raise ValueError('Source exceeds acquisition cap')
    stream.write(data)
  tmp.replace(dest)
 records.append({'file':relative,'url':url,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size})
(ROOT/'work/science-manifest.json').write_text(json.dumps({'version':'research-analysis-v1','sources':records},indent=2))
(ROOT/'app/public/data/science-manifest.json').write_text(json.dumps({'version':'research-analysis-v1','sources':records},indent=2))
print('Science sources acquired; restart npm run dev to load new kernels.')
