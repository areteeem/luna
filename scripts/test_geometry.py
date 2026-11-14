"""Scientific invariants and an independent regression against cached JPL Horizons."""
import json, math, unittest
from pathlib import Path
from geometry_server import load_kernels,calculate
ROOT=Path(__file__).resolve().parents[1]
class LocalGeometryTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  load_kernels();cls.payload={'start':'2026-11-14T00:00:00Z','lat':-89.5,'lon':0,'duration':48,'step':3600};cls.result=calculate(cls.payload)
 def test_matches_independent_horizons_fixture(self):
  fixture=json.loads((ROOT/'data/ephemeris-fixture.json').read_text())
  for body in ['sun','earth']:
   for i,row in enumerate(self.result['rows']):
    self.assertAlmostEqual(row[body]['elevation'],fixture['bodies'][body][i]['elevation_deg'],delta=.0001)
    self.assertAlmostEqual(row[body]['azimuth'],fixture['bodies'][body][i]['azimuth_deg'],delta=.0001)
 def test_coordinate_and_time_changes_have_real_effects(self):
  shifted=calculate({**self.payload,'lat':0,'lon':90,'start':'2026-12-01T00:00:01Z','duration':1})
  self.assertGreater(abs(shifted['rows'][0]['sun']['elevation']-self.result['rows'][0]['sun']['elevation']),10)
 def test_endpoint_and_seconds(self):
  value=calculate({**self.payload,'start':'2026-11-14T00:00:17Z','duration':.5,'step':900})
  self.assertEqual(len(value['rows']),3);self.assertEqual(value['rows'][-1]['time'],'2026-11-14T00:30:17Z')
 def test_planning_orbit_preserves_radius_and_moves(self):
  result=calculate({**self.payload,'duration':1,'satellites':[{'id':'r','altitude':100,'inclination':90,'raan':0,'phase':0}]})
  for row in result['rows']:
   self.assertAlmostEqual(math.sqrt(sum(x*x for x in row['satellites']['r']['position'])),1837.4,places=6)
  self.assertNotEqual(result['rows'][0]['satellites']['r']['position'],result['rows'][-1]['satellites']['r']['position'])
 def test_invalid_inputs_fail_closed(self):
  for fields in [{'lat':91},{'lon':float('nan')},{'duration':800},{'start':'2055-01-01T00:00:00Z'}]:
   with self.assertRaises(ValueError):calculate({**self.payload,**fields})
if __name__=='__main__':unittest.main()
