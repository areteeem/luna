import math,unittest,json
from unittest.mock import patch
import numpy as np
from affine import Affine
from geometry_server import load_kernels,calculate
from mission_models import circle_overlap_fraction,disk_visible_fraction,rf_budget,refine_root,simulate_battery,DEFAULTS,normalize,station_at,observer_basis
from terrain_model import cartesian,horizon_at,safety_screen
import spiceypy as sp
class AnalyticModelTests(unittest.TestCase):
 def test_disk_overlap_limits_and_known_equal_circle_case(self):
  self.assertEqual(circle_overlap_fraction(1,2,0),1);self.assertEqual(circle_overlap_fraction(1,1,3),0);self.assertAlmostEqual(circle_overlap_fraction(1,1,1),(2*math.pi/3-math.sqrt(3)/2)/math.pi)
 def test_reference_plane_disk_fraction(self):
  self.assertEqual(disk_visible_fraction(0,1,0),.5);self.assertEqual(disk_visible_fraction(2,1,0),1);self.assertEqual(disk_visible_fraction(-2,1,0),0)
 def test_rf_inverse_square_and_bitrate_scaling(self):
  a=rf_budget(384400,DEFAULTS);b=rf_budget(768800,DEFAULTS);c=rf_budget(384400,{**DEFAULTS,'bitrate_bps':DEFAULTS['bitrate_bps']*2})
  self.assertAlmostEqual(b['free_space_loss_db']-a['free_space_loss_db'],20*math.log10(2));self.assertAlmostEqual(a['nominal_margin_db']-c['nominal_margin_db'],10*math.log10(2))
 def test_root_bracket_not_sample_interpolation(self):
  r=refine_root(lambda t:t*t-2,1,2,1e-6);self.assertLessEqual(r['bracket_seconds'],1e-6);self.assertLess(abs(r['et']-math.sqrt(2)),1e-6)
 def test_battery_night_energy_conservation_and_end_sample(self):
  cfg={**DEFAULTS,'battery_wh':200,'initial_soc':1,'charge_efficiency':1,'discharge_efficiency':1,'base_load_w':100,'active_load_w':0}
  rows=[{'elapsed':i,'power_nominal_w':0,'power_lower_w':0} for i in range(3)];trace,s=simulate_battery(rows,cfg,[])
  self.assertEqual(s['load_wh'],200);self.assertEqual(trace[-1]['battery_nominal_wh'],0);self.assertEqual(s['nominal_unserved_wh'],0)
 def test_activity_overlap_adds_load(self):
  rows=[{'elapsed':0,'power_nominal_w':0,'power_lower_w':0},{'elapsed':1,'power_nominal_w':0,'power_lower_w':0}];trace,s=simulate_battery(rows,{**DEFAULTS,'base_load_w':0,'active_load_w':10},[{'offset':0,'duration':1},{'offset':0,'duration':1}]);self.assertEqual(s['load_wh'],20)
 def test_short_activity_between_samples_is_integrated(self):
  rows=[{'elapsed':0,'power_nominal_w':0,'power_lower_w':0},{'elapsed':1,'power_nominal_w':0,'power_lower_w':0}]
  _,summary=simulate_battery(rows,{**DEFAULTS,'base_load_w':0,'active_load_w':100},[{'offset':.25,'duration':.1}]);self.assertAlmostEqual(summary['load_wh'],10)
 def test_unknown_terrain_not_flat_horizon(self):
  self.assertIsNone(horizon_at({'azimuth_deg':[]},0));p={'azimuth_deg':[0,180],'azimuth_step_deg':180,'elevation_deg':[10,20],'bounded_sectors':[True,True]};self.assertAlmostEqual(horizon_at(p,359),10+10/180);p['bounded_sectors'][0]=False;self.assertIsNone(horizon_at(p,1))
 def test_curved_sphere_ray_matches_spherical_limb_geometry(self):
  theta=.01;q=cartesian(np.array(math.degrees(theta)),np.array(0),np.array(0));origin=np.array([1737400.,0,0]);v=q-origin;self.assertAlmostEqual(math.atan2(v[0],math.hypot(v[1],v[2])),-theta/2,places=10)
 def test_native_plane_screen_does_not_certify_landing(self):
  yy,xx=np.mgrid[0:40,0:40];x=-100+(xx+.5)*5;y=100-(yy+.5)*5;grid=((1000+.1*x+.2*y).astype('float32'),Affine(5,0,-100,0,-5,100),(-100,-100,100,100),5)
  with patch('terrain_model.raster',return_value=grid),patch('terrain_model.TO_SP') as transform:
   transform.transform.return_value=(0,0);r=safety_screen(-90,0,20,10,.3)
  self.assertAlmostEqual(r['slope_deg'],math.degrees(math.atan(math.sqrt(.05))),places=3);self.assertEqual(r['landing_clearance'],'not established');self.assertEqual(r['status'],'screen-exceeds-threshold')
 def test_bad_hardware_inputs_fail_closed(self):
  for cfg in [{'tx_power_w':0},{'panel_efficiency':2},{'initial_soc':.1,'minimum_soc':.9},{'system_noise_k':float('nan')}]:
   with self.assertRaises(ValueError):normalize(cfg)
class KernelIntegrationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):load_kernels()
 def test_nasa_2022_eclipse_is_total_at_nearside_observer(self):
  p={'lat':0,'lon':0,'height':0,'start':'2022-11-08T10:00:00Z','duration':3,'step':600,'analysis':{**DEFAULTS,'enabled':True,'terrain':False}}
  a=calculate(p)['analysis'];row=min(a['rows'],key=lambda r:abs(r['elapsed']-1));self.assertEqual(row['eclipse']['state'],'total');self.assertEqual(row['power_nominal_w'],0);self.assertTrue(any(x['kind']=='eclipse-total-contact' for x in a['events']));self.assertTrue(all(x['bracket_seconds']<=1 for x in a['events']))
 def test_apollo_epoch_supported_without_fabricating_hazard_coverage(self):
  p={'lat':20.19,'lon':30.77,'height':0,'start':'1972-12-11T19:54:57Z','duration':1,'step':900,'analysis':{**DEFAULTS,'enabled':True,'terrain':False}}
  a=calculate(p)['analysis'];self.assertEqual(a['landing']['status'],'unassessed');self.assertEqual(a['landing']['landing_clearance'],'not established')
 def test_definitive_lro_shadow_and_coverage(self):
  sat={'id':'lro','ephemeris':'LRO-2022','altitude':50,'inclination':90,'raan':0,'phase':0}
  p={'lat':0,'lon':0,'height':0,'start':'2022-11-08T08:00:00Z','duration':7,'step':300,'satellites':[sat]}
  g=calculate(p);states=[r['satellites']['lro'] for r in g['rows']]
  self.assertTrue(all(1737<np.linalg.norm(r['position'])<2000 for r in states));self.assertTrue(any('Earth eclipse' in r['solar_state'] for r in states));self.assertTrue(any(r['solar_unocculted_fraction']==0 for r in states));self.assertIsNone(g['orbits']['lro']['period_seconds'])
  with self.assertRaises(ValueError):calculate({**p,'start':'2026-11-14T00:00:00Z'})
 def test_earth_station_elevation_matches_spice_topocentric_frame(self):
  et=sp.str2et('2026-11-14T00:00:00');_,up,east,north=observer_basis(0,0,0);r=station_at(et,np.zeros(3),up,east,north,{**DEFAULTS,'terrain':False},{'azimuth_deg':[]});vector,_=sp.spkpos('MOON',et,'DSS-14_TOPO','LT+S','DSS-14');elevation=math.degrees(math.atan2(vector[2],math.hypot(vector[0],vector[1])));self.assertAlmostEqual(r['earth_station_elevation_deg'],elevation,places=5)
if __name__=='__main__':unittest.main()
