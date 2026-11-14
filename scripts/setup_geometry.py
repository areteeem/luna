"""Acquire bounded official NASA kernels for the local calculation service."""
from pathlib import Path
import urllib.request, hashlib, json
ROOT=Path(__file__).resolve().parents[1]
SOURCES={'naif0012.tls':'lsk/naif0012.tls','pck00011.tpc':'pck/pck00011.tpc','de440s.bsp':'spk/planets/de440s.bsp','moon_pa_de421_1900-2050.bpc':'pck/moon_pa_de421_1900-2050.bpc','moon_080317.tf':'fk/satellites/moon_080317.tf'}
folder=ROOT/'work/kernels';folder.mkdir(parents=True,exist_ok=True)
records=[]
for name,path in SOURCES.items():
    dest=folder/name;url='https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'+path
    if not dest.exists() or (name=='de440s.bsp' and dest.stat().st_size != 32726016):
        temp=dest.with_suffix('.download')
        with urllib.request.urlopen(url,timeout=180) as response, temp.open('wb') as f:
            total=0
            while chunk:=response.read(1024*1024):
                total+=len(chunk)
                if total>40*1024*1024:raise ValueError('Kernel exceeds size cap')
                f.write(chunk)
        temp.replace(dest)
    records.append({'name':name,'url':url,'bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
(folder/'manifest.json').write_text(json.dumps(records,indent=2))
print('NASA kernels ready')
