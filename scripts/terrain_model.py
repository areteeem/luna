"""Bounded, sampled lunar horizons and DEM hazard screening, with explicit unknowns."""
from pathlib import Path
from functools import lru_cache
import math
import numpy as np
import rasterio
from pyproj import CRS, Transformer
ROOT=Path(__file__).resolve().parents[1]
R=1737400.0
CRS_LL=CRS.from_proj4('+proj=longlat +R=1737400 +no_defs')
CRS_SP=CRS.from_proj4('+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs')
TO_SP=Transformer.from_crs(CRS_LL,CRS_SP,always_xy=True)

@lru_cache(maxsize=2)
def raster(name):
    path=ROOT/'work/terrain'/name
    if not path.exists():return None
    try:
        with rasterio.open(path) as src:
            array=src.read(1).astype('float32')*src.scales[0]+src.offsets[0]
            if src.nodata is not None and math.isfinite(src.nodata):array[array==src.nodata]=np.nan
            return array,src.transform,tuple(src.bounds),float(abs(src.transform.a))
    except rasterio.errors.RasterioError:return None

def interpolate_grid(grid,x,y):
    arr,transform,bounds,_=grid
    col=(x-transform.c)/transform.a-.5;row=(y-transform.f)/transform.e-.5
    valid=(col>=0)&(row>=0)&(col<arr.shape[1]-1)&(row<arr.shape[0]-1)
    # Polar projections can be nonfinite outside their domain. Mask before
    # indexing/interpolation, preserving explicit unknown coverage.
    col=np.where(valid,col,0.);row=np.where(valid,row,0.)
    c=np.clip(np.floor(col).astype('int64'),0,arr.shape[1]-2);r=np.clip(np.floor(row).astype('int64'),0,arr.shape[0]-2)
    fx=col-c;fy=row-r
    z=arr[r,c]*(1-fx)*(1-fy)+arr[r,c+1]*fx*(1-fy)+arr[r+1,c]*(1-fx)*fy+arr[r+1,c+1]*fx*fy
    return np.where(valid,z,np.nan)

def elevations(lon,lat):
    x,y=TO_SP.transform(lon,lat)
    shape=np.broadcast_arrays(np.asarray(lon),np.asarray(lat))[0].shape
    z=np.full(shape,np.nan);resolution=np.full(shape,np.nan)
    for name in ['lola80s.tif','site04.tif']:
        grid=raster(name)
        if grid is None:continue
        values=interpolate_grid(grid,np.asarray(x),np.asarray(y));mask=np.isfinite(values)
        z=np.where(mask,values,z);resolution=np.where(mask,grid[3],resolution)
    return z,resolution

def cartesian(lon,lat,z):
    lam=np.radians(lon);phi=np.radians(lat);radius=R+z
    return np.stack([radius*np.cos(phi)*np.cos(lam),radius*np.cos(phi)*np.sin(lam),radius*np.sin(phi)],axis=-1)

@lru_cache(maxsize=12)
def horizon(lat,lon,mast=2.,uncertainty=.5,range_km=250.,az_step=.5):
    if not all(map(math.isfinite,[lat,lon,mast,uncertainty,range_km,az_step])):raise ValueError('Finite terrain inputs required')
    z,res=elevations(np.asarray(lon),np.asarray(lat))
    if not np.isfinite(z):return {'status':'unavailable','reason':'No local DEM coverage. No flat terrain substituted.','observer_height_m':None,'azimuth_deg':[],'elevation_deg':[],'upper_deg':[],'lower_deg':[],'complete':False}
    height=float(z)+mast;phi=math.radians(lat);lam=math.radians(lon)
    up=np.array([math.cos(phi)*math.cos(lam),math.cos(phi)*math.sin(lam),math.sin(phi)]);east=np.array([-math.sin(lam),math.cos(lam),0]);north=np.cross(up,east);observer=up*(R+height)
    azimuths=np.arange(0,360,az_step)
    # Near 5 m rays where the native 5 m DEM exists; regional native cells are 80 m.
    ranges=np.unique(np.concatenate([np.arange(5,2005,5),np.arange(2020,5020,20),np.arange(5080,range_km*1000+1,80)]));theta=ranges/R
    result=[];low=[];high=[];coverage=[]
    for start in range(0,len(azimuths),32):
        az=np.radians(azimuths[start:start+32])[:,None]
        latitudes=np.arcsin(np.sin(phi)*np.cos(theta)+np.cos(phi)*np.sin(theta)*np.cos(az))
        longitudes=lam+np.arctan2(np.sin(az)*np.sin(theta)*np.cos(phi),np.cos(theta)-np.sin(phi)*np.sin(latitudes))
        heights,_=elevations(np.degrees(longitudes),np.degrees(latitudes));positions=cartesian(np.degrees(longitudes),np.degrees(latitudes),heights)
        v=positions-observer;vertical=v@up;horizontal=np.hypot(v@east,v@north)
        nominal=np.degrees(np.arctan2(vertical,horizontal))
        good=np.isfinite(nominal)
        for i in range(len(az)):
            if not good[i].any():result.append(None);low.append(None);high.append(None);coverage.append(False);continue
            values=nominal[i,good[i]];dist=horizontal[i,good[i]];verts=vertical[i,good[i]]
            result.append(float(values.max()));low.append(float(np.degrees(np.arctan2(verts-2*uncertainty,dist)).max()));high.append(float(np.degrees(np.arctan2(verts+2*uncertainty,dist)).max()));coverage.append(bool(good[i].all()))
    # Beyond-range exclusion only under the disclosed, user-research bound of 15 km elevation.
    angle=range_km*1000/R;far_bound=math.degrees(math.atan2((R+15000)*math.cos(angle)-(R+height),(R+15000)*math.sin(angle)))
    bounded=[covered and value is not None and value>=far_bound for covered,value in zip(coverage,low)]
    complete=all(bounded)
    return {'status':'sampled-bounded' if complete else 'partial','complete':complete,'reason':'Sampled horizon; bounded far field under 15 km global height assumption. Not a validated continuous-terrain guarantee.' if complete else 'Missing terrain or unbounded far-field sectors; visibility remains unknown in those sectors.','observer_height_m':height,'ground_height_m':float(z),'mast_height_m':mast,'native_site_pixel_m':float(res),'azimuth_step_deg':az_step,'range_step_m':{'near':5,'middle':20,'far':80},'range_km':range_km,'far_field_upper_deg':far_bound,'global_height_bound_m':15000,'height_perturbation_m':uncertainty,'uncertainty_type':'deterministic relative-height sensitivity, not statistical confidence','azimuth_deg':azimuths.tolist(),'elevation_deg':result,'lower_deg':low,'upper_deg':high,'bounded_sectors':bounded,'sources':['NASA LOLA Site04 5 m (where covered)','NASA LOLA 80S 80 m regional (where covered)'],'limitations':['Finite angular/range sampling may miss sub-grid features','DEM grid spacing is not effective terrain resolution','No terrain error raster or uncertainty ensemble assimilated']}

def horizon_at(profile,azimuth,variant='elevation_deg'):
    if not profile.get('azimuth_deg'):return None
    step=profile['azimuth_step_deg'];p=(azimuth%360)/step;i=int(math.floor(p));j=(i+1)%len(profile[variant]);a=profile[variant][i];b=profile[variant][j]
    if a is None or b is None or not profile['bounded_sectors'][i] or not profile['bounded_sectors'][j]:return None
    return a+(b-a)*(p-i)

def safety_screen(lat,lon,footprint_m=20,slope_limit=10,roughness_limit=.3):
    native=raster('site04.tif');x,y=TO_SP.transform(lon,lat)
    if native is None:return {'status':'unassessed','reason':'No high-resolution terrain loaded','landing_clearance':'not established'}
    arr,transform,_,resolution=native
    c0=int(math.floor((x-transform.c)/transform.a));r0=int(math.floor((y-transform.f)/transform.e));extent=int(math.ceil(footprint_m/resolution))+1
    rr,cc=np.meshgrid(np.arange(r0-extent,r0+extent+1),np.arange(c0-extent,c0+extent+1),indexing='ij')
    xx=transform.c+(cc+.5)*transform.a-x;yy=transform.f+(rr+.5)*transform.e-y;inside=xx*xx+yy*yy<=footprint_m**2
    rr=rr[inside];cc=cc[inside];dx=xx[inside];dy=yy[inside]
    in_bounds=(rr>=0)&(cc>=0)&(rr<arr.shape[0])&(cc<arr.shape[1]);z=arr[np.clip(rr,0,arr.shape[0]-1),np.clip(cc,0,arr.shape[1]-1)];valid=in_bounds&np.isfinite(z);coverage=float(valid.mean()) if len(valid) else 0
    if coverage<1 or len(z)<6:return {'status':'unassessed','reason':'Footprint lacks complete native 5 m Site04 coverage','coverage_fraction':coverage,'landing_clearance':'not established'}
    design=np.column_stack([dx,dy,np.ones(len(z))]);fit=np.linalg.lstsq(design,z,rcond=None)[0];residual=z-design@fit;slope=math.degrees(math.atan(math.hypot(fit[0],fit[1])));roughness=float(np.sqrt(np.mean(residual**2)))
    return {'status':'screen-exceeds-threshold' if slope>slope_limit or roughness>roughness_limit else 'screen-within-threshold','landing_clearance':'not established','slope_deg':slope,'roughness_rms_m':roughness,'peak_to_peak_residual_m':float(np.ptp(residual)),'footprint_radius_m':footprint_m,'grid_m':5,'samples':len(z),'coverage_fraction':coverage,'thresholds':{'slope_deg':slope_limit,'roughness_rms_m':roughness_limit},'threshold_source':'user-defined screening limits; not vehicle certification','unknown_hazards':['Sub-grid rocks and craters','Bearing strength and regolith mechanics','Plume interaction and dust','Navigation/landing ellipse uncertainty','Vehicle landing-gear and egress geometry','DEM systematic error and effective resolution']}
