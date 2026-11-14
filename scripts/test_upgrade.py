import base64,io,json,tempfile,unittest,time
from pathlib import Path
from unittest.mock import patch,Mock
import numpy as np
from PIL import Image
import ai_service as ai
import offline_service as offline
from site_recommendations import destination,recommend,global_lattice,qualifies
from geometry_server import load_kernels
from mission_models import DEFAULTS,simulate_battery

class AIContractTests(unittest.TestCase):
 def tearDown(self):ai.PROFILES.clear()
 def test_provider_detection_is_local_and_never_probes_other_hosts(self):
  self.assertEqual(ai.detect('AIza-test'),'gemini');self.assertEqual(ai.detect('sk-proj-test'),'openai')
  for key in ['unknown','sk-ant-other-provider','sk-or-other-provider']:
   with self.assertRaises(ValueError):ai.detect(key)
 def test_connect_discovers_models_and_does_not_return_key(self):
  with patch('ai_service.models',return_value=[{'id':'test-model'}]) as call:
   result=ai.connect({'provider':'auto','key':'sk-proj-fake-not-a-secret'});self.assertEqual(result['provider'],'openai');self.assertNotIn('sk-proj-fake',json.dumps(result));call.assert_called_once_with('openai','sk-proj-fake-not-a-secret')
 def test_openai_response_uses_responses_api_and_actual_model(self):
  ai.PROFILES['openai']={'key':'fake','models':[{'id':'model-from-list'}]}
  response={'output':[{'content':[{'type':'output_text','text':'{"reply":"Done","actions":[{"type":"open_panel","panel":"map"}]}'}]}]}
  with patch('ai_service.provider_json',return_value=response) as call:
   result=ai.chat({'provider':'openai','model':'model-from-list','messages':[{'role':'user','content':'Show map'}]});self.assertEqual(result['actions'][0]['type'],'open_panel');self.assertEqual(call.call_args.args[1],'https://api.openai.com/v1/responses');self.assertFalse(call.call_args.kwargs['json']['store'])
 def test_gemini_discovery_filters_non_generation_models_and_pages(self):
  pages=[{'models':[{'name':'models/a','supportedGenerationMethods':['generateContent']},{'name':'models/embed','supportedGenerationMethods':['embedContent']}],'nextPageToken':'next'},{'models':[{'name':'models/b','supportedGenerationMethods':['generateContent']}]}]
  with patch('ai_service.provider_json',side_effect=pages):self.assertEqual([m['id'] for m in ai.models('gemini','fake')],['a','b'])
 def test_attachment_text_is_untrusted_and_size_limited(self):
  text,images=ai.attachment_text([{'name':'notes.md','type':'text/markdown','data':base64.b64encode('α study'.encode()).decode()}]);self.assertIn('UNTRUSTED ATTACHMENT',text);self.assertIn('α study',text);self.assertFalse(images)
 def test_unlisted_model_rejected_before_network(self):
  ai.PROFILES['ollama']={'key':'','models':[{'id':'allowed'}]}
  with patch('ai_service.provider_json') as call:
   with self.assertRaises(ValueError):ai.chat({'provider':'ollama','model':'invented'})
   call.assert_not_called()
 def test_ollama_native_action_tool_calls_become_app_actions(self):
  ai.PROFILES['ollama']={'key':'','models':[{'id':'qwen2.5:0.5b','bytes':1000}]}
  response={'message':{'content':'','tool_calls':[{'function':{'name':'luna_app_actions','arguments':{'reply':'Opening the lunar map.','actions':[{'type':'open_panel','panel':'map'}]}}}]}}
  with patch('ai_service.provider_json',return_value=response) as call:
   result=ai.chat({'provider':'ollama','model':'qwen2.5:0.5b','messages':[{'role':'user','content':'Open map'}]})
  self.assertEqual(result['actions'],[{'type':'open_panel','panel':'map'}])
  self.assertEqual(call.call_args.kwargs['json']['tools'][0]['function']['name'],'luna_app_actions')
 def test_local_ai_setup_starts_runtime_and_reuses_installed_model(self):
  ai.JOBS.clear()
  catalog=next(item for item in ai.CATALOG if item['id']=='qwen2.5:0.5b')
  with patch('ai_service.recommended_local_model',return_value=catalog),patch('ai_service.resources',return_value={'available_ram_gb':8,'disk_free_gb':20}),patch('ai_service.ensure_runtime') as start,patch('ai_service.models',return_value=[{'id':'qwen2.5:0.5b','bytes':1000}]):
   result=ai.start_job('prepare',{})
   for _ in range(150):
    job=ai.handle_get('/api/ai/job/'+result['job'])
    if job['status'] in ('complete','error'):break
    time.sleep(.01)
  self.assertEqual(job['status'],'complete',job)
  self.assertEqual(job['model'],'qwen2.5:0.5b')
  start.assert_called_once_with(install_if_missing=True)

class OfflineCacheTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.cache=patch.object(offline,'CACHE',self.root);self.cache.start();self.mode=patch.object(offline,'OFFLINE',True);self.mode.start()
 def tearDown(self):self.cache.stop();self.mode.stop();self.tmp.cleanup()
 def test_global_native_pyramid_count_and_bounds(self):
  self.assertEqual(sum(1 for _ in offline.tiles_for('imagery',8,[-180,-90,180,90])),174762)
  with self.assertRaises(ValueError):list(offline.tiles_for('../secrets',1,[-180,-90,180,90]))
 def test_offline_serves_existing_tile_without_network(self):
  path=offline.tile_key('imagery',0,0,0);path.parent.mkdir(parents=True);path.write_bytes(b'cached')
  with patch('offline_service.session') as call:self.assertEqual(offline.get_tile('imagery',0,0,0),b'cached');call.assert_not_called()
 def test_missing_native_tile_is_explicit_or_lower_resolution_fallback(self):
  im=Image.new('RGB',(256,256),'red');path=offline.tile_key('imagery',0,0,0);path.parent.mkdir(parents=True);im.save(path)
  with patch('offline_service.session') as call:
   status,body,mime,headers=offline.serve_tile('/api/tiles/imagery/1/0/0.jpg');self.assertEqual(status,200);self.assertIn('lower detail',headers['X-Luna-Resolution']);call.assert_not_called();self.assertEqual(Image.open(io.BytesIO(body)).size,(256,256))
  with self.assertRaises(FileNotFoundError):offline.get_tile('imagery',2,0,7)
 def test_restart_marks_running_pack_interrupted_and_preserves_bounds(self):
  job={'id':'a'*32,'status':'running','layer':'imagery','level':8,'bbox':[22.8,.01,24.15,1.34],'done':7,'total':15,'cancel':False}
  offline.save_job(job)
  with patch.object(offline,'JOBS',{}):
   offline.load_jobs();restored=offline.JOBS[job['id']]
   self.assertEqual(restored['status'],'interrupted');self.assertEqual(restored['done'],7);self.assertEqual(restored['bbox'],job['bbox'])
   self.assertEqual(json.loads((self.root/('pack-'+job['id']+'.json')).read_text())['status'],'interrupted')
 def test_resume_reuses_same_manifest_and_retries_failed_tiles(self):
  job={'id':'b'*32,'status':'incomplete','layer':'imagery','level':0,'bbox':[-180,-90,180,90]}
  with patch.object(offline,'JOBS',{job['id']:job}),patch.object(offline,'OFFLINE',False),patch('offline_service.get_tile',return_value=b'cached') as fetch:
   with patch('offline_service.threading.Thread') as thread:
    result=offline.handle_post('/api/offline/resume',{'job':job['id']});self.assertEqual(result['job'],job['id']);work=thread.call_args.kwargs['target']
   work()
   manifest=json.loads((self.root/('pack-'+job['id']+'.json')).read_text())
   self.assertEqual(manifest['status'],'complete');self.assertEqual(manifest['done'],2);self.assertEqual(manifest['failed'],0);self.assertEqual(fetch.call_count,2)
 def test_failed_tile_never_marks_pack_complete(self):
  with patch.object(offline,'JOBS',{}),patch.object(offline,'OFFLINE',False),patch('offline_service.get_tile',side_effect=OSError('unavailable')):
   with patch('offline_service.threading.Thread') as thread:
    result=offline.start_pack({'level':0});work=thread.call_args.kwargs['target']
   work()
   manifest=json.loads((self.root/('pack-'+result['job']+'.json')).read_text())
   self.assertEqual(manifest['status'],'incomplete');self.assertEqual(manifest['failed'],2)

class RecommendationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):load_kernels()
 def test_destination_distance_is_lunar_kilometers(self):
  lat,lon=destination(0,0,90,2);self.assertAlmostEqual(lat,0);self.assertAlmostEqual(np.radians(lon)*1737.4,2)
 def test_unknown_terrain_cannot_be_ranked_as_solar_improvement(self):
  with patch('site_recommendations.horizon',return_value={'status':'unavailable','azimuth_deg':[]}),patch('site_recommendations.elevations',return_value=(np.array(float('nan')),np.array(0))),patch('site_recommendations.safety_screen',return_value={'status':'unassessed'}):
   result=recommend({'lat':0,'lon':0,'height':0,'start':'2026-11-14T00:00:00Z','duration':1,'radius_km':1,'analysis':{'terrain':True}})
  self.assertEqual(len(result['candidates']),16);self.assertIsNone(result['baseline']['solar_hours']);self.assertTrue(all(not c['better_sunlight'] and c['delta_energy_wh'] is None for c in result['candidates']))
 def test_known_candidate_comparisons_serialize_as_json(self):
  profile={'status':'sampled-bounded','azimuth_deg':[0,180],'elevation_deg':[0,0],'bounded_sectors':[True,True],'azimuth_step_deg':180,'observer_height_m':2}
  with patch('site_recommendations.horizon',return_value=profile),patch('site_recommendations.elevations',return_value=(np.array(0.),np.array(80))),patch('site_recommendations.safety_screen',return_value={'status':'unassessed'}):
   result=recommend({'lat':0,'lon':0,'height':0,'start':'2026-11-14T00:00:00Z','duration':1,'radius_km':1,'analysis':{'terrain':True}})
  json.dumps(result,allow_nan=False);self.assertIsInstance(result['candidates'][0]['better_sunlight'],bool)
 def test_global_grid_has_single_pole_and_no_duplicate_points(self):
  points=global_lattice()
  self.assertEqual(len(points),len(set(points)))
  self.assertEqual(sum(lat==90 for lat,lon in points),1)
  self.assertEqual(sum(lat==-90 for lat,lon in points),1)
 def test_date_candidates_start_today_and_satisfy_joint_station_screen(self):
  from datetime import datetime,timezone
  before=datetime.now(timezone.utc).replace(microsecond=0)
  result=recommend({'lat':-89.7,'lon':-30,'height':0,'start':'2026-11-14T00:00:00Z','duration':24,'radius_km':2,'analysis':{'terrain':False}})
  candidates=result['date_candidates']
  self.assertEqual(len(candidates),3)
  starts=[datetime.fromisoformat(c['start'].replace('Z','+00:00')) for c in candidates]
  self.assertEqual(starts,sorted(starts))
  self.assertGreaterEqual(starts[0],before)
  self.assertEqual(candidates[0]['days_from_today'],0)
  self.assertTrue(all(qualifies(c,24) and c['station']=='DSS-14' for c in candidates))
  self.assertGreater(len(result['same_date_candidates']),100)
  self.assertGreater(len({(c['lat'],c['lon']) for c in result['same_date_candidates']}),100)
 def test_recharge_activity_does_not_add_science_load(self):
  rows=[{'elapsed':0,'power_nominal_w':0,'power_lower_w':0},{'elapsed':1,'power_nominal_w':0,'power_lower_w':0}]
  _,result=simulate_battery(rows,{**DEFAULTS,'base_load_w':10,'active_load_w':100},[{'offset':0,'duration':1,'type':'power'}]);self.assertEqual(result['load_wh'],10)
if __name__=='__main__':unittest.main()
