"""Create display rasters from the NASA LOLA Site04 DEM; no visibility inference."""
import json
import hashlib
import sys
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling

source = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / 'app/public/terrain'
out.mkdir(parents=True, exist_ok=True)
with rasterio.open(source) as dem:
    z = dem.read(1, out_shape=(1600, 1600), resampling=Resampling.bilinear)
    valid = np.isfinite(z)
    z = np.where(valid, z, 0)
    dy, dx = np.gradient(z, 10, 10)
    normal = np.sqrt(dx*dx + dy*dy + 1)
    # Fixed display lighting, unrelated to the selected ephemeris timestamp.
    light = np.clip((-dx * -.5 + dy * -.5 + .707) / normal, 0, 1)
    gray = np.clip(35 + light * 200, 0, 255).astype('uint8')
    with rasterio.open(out/'hillshade.png', 'w', driver='PNG', width=1600, height=1600, count=1, dtype='uint8') as dst:
        dst.write(gray, 1)
    t = np.clip((z - np.percentile(z[valid], 2)) / (np.percentile(z[valid], 98)-np.percentile(z[valid], 2)), 0, 1)
    stops = np.array([[35,51,66],[76,101,108],[143,151,133],[201,183,137],[231,218,190]])
    rgb = np.stack([np.interp(t, np.linspace(0,1,5), stops[:,i]) for i in range(3)])
    rgb = np.clip(rgb * (.55 + .55*light), 0, 255).astype('uint8')
    with rasterio.open(out/'elevation.png', 'w', driver='PNG', width=1600, height=1600, count=3, dtype='uint8') as dst:
        dst.write(rgb)
    meta = {'source_url':'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_surf.tif', 'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'bounds_m':list(dem.bounds), 'source_pixel_m':5, 'display_pixel_m':10, 'radius_m':1737400, 'crs_wkt':str(dem.crs), 'lighting':'Fixed northwest display illumination; not simulated solar illumination', 'purpose':'Terrain context only; distinct from astronomy observer at 89.5 S, 0 E'}
    (out/'metadata.json').write_text(json.dumps(meta, indent=2))
    (out.parents[1]/'src/terrain-metadata.json').write_text(json.dumps(meta,indent=2))
print('Rendered real Site04 terrain context')
