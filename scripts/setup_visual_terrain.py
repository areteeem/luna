"""Acquire the bounded 33 MB official global LOLA display grid and its label."""
from pathlib import Path
import hashlib
import json
import urllib.request
ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/'
records = []
for filename in ['ldem_16.lbl', 'ldem_16.img']:
    target = ROOT / 'work/terrain' / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix('.download')
        with urllib.request.urlopen(BASE+filename, timeout=180) as response, temporary.open('wb') as output:
            size = 0
            while chunk := response.read(1024*1024):
                size += len(chunk)
                if size > 34*1024*1024: raise ValueError('Terrain download exceeds expected size')
                output.write(chunk)
        temporary.replace(target)
    if filename.endswith('.img') and target.stat().st_size != 33177600: raise ValueError('Incorrect global terrain grid size')
    records.append({'file': filename, 'url': BASE+filename, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
manifest = json.dumps({'source': 'NASA LRO LOLA LDEM_16 V3.1', 'height_scale_m': .5, 'reference_radius_m': 1737400, 'sources': records}, indent=2)
(ROOT/'work/terrain/visual-manifest.json').write_text(manifest)
(ROOT/'app/public/data').mkdir(parents=True, exist_ok=True)
(ROOT/'app/public/data/visual-terrain-manifest.json').write_text(manifest)
print('Global LOLA display terrain ready.')
