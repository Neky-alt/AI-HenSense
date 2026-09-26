import './register.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
process.env.EXPO_PUBLIC_API_BASE_URL='http://backend.test:8006';
const { mapDetection,mapDevice,withDetection,getFreeRangeResults,getDetectionsByDeviceId,getDashboardSummary }=await import('../src/services/detectionService.ts');
const { apiGet,resolveBackendUrl }=await import('../src/services/apiClient.ts');
const row={detection_id:'d1',device_id:'c1',detected_at:'2026-09-24T10:00:00Z',trigger_type:'manual',capture_source_type:'file_upload',normal_count:8,low_count:9,total_count:17,normal_ratio:8/17,low_ratio:9/17,monitoring_status:'normal',confidence:null,image_url:'/api/v1/devices/c1/detections/d1/image',annotated_image_url:'/api/v1/devices/c1/detections/d1/annotated-image',image_path:'opaque/file.jpg',image_deleted_at:null};
const rawDevice={device_id:'c1',device_code:'CAGE-01',device_name:null,farming_type:'caged',device_status:'offline',latest_detection:row};
const ok=data=>Response.json({success:true,data,error:null});
test('Offline keeps actual counts, backend warning decision, ID/time and both same-record media',()=>{
 const d=mapDevice(rawDevice);assert.equal(d.normal_count,8);assert.equal(d.low_count,9);assert.equal(d.total_count,17);assert.equal(d.low_ratio,9/17);assert.equal(d.monitoring_status,'normal');assert.equal(d.latest_detection_id,'d1');assert.equal(d.detected_at,row.detected_at);assert.equal(d.device_status,'offline');assert.equal(d.device_name,'CAGE-01');assert.equal(d.image_url,'http://backend.test:8006'+row.image_url);assert.equal(d.annotated_image_url,'http://backend.test:8006'+row.annotated_image_url);
});
test('Zero-object detection is a recorded result with null ratios, not missing data',()=>{
 const d=mapDevice({...rawDevice,latest_detection:{...row,total_count:0,normal_count:0,low_count:0,normal_ratio:null,low_ratio:null}});assert.equal(d.latest_detection_id,'d1');assert.equal(d.total_count,0);assert.equal(d.normal_ratio,null);
});
test('No detection has no ID, no monitoring status and no invented photo',()=>{
 const d=mapDevice({...rawDevice,latest_detection:null});assert.equal(d.latest_detection_id,null);assert.equal(d.image_url,null);assert.equal(d.annotated_image_url,null);assert.equal(d.monitoring_status,null);
});
test('Missing historical media stays missing; deleted media removes both variants',()=>{
 const d=mapDetection({...row,image_url:null,image_path:null,annotated_image_url:null});assert.equal(d.screenshot_url,null);assert.equal(d.annotated_image_url,null);
 const deleted=mapDetection({...row,image_deleted_at:'2026-09-24T11:00:00Z'});assert.equal(deleted.screenshot_url,null);assert.equal(deleted.annotated_image_url,null);
});
test('Legacy image_path resolves a same-ID API endpoint, never local filesystem path',()=>{
 assert.equal(mapDetection({...row,image_url:null,annotated_image_url:null}).screenshot_url,'http://backend.test:8006/api/v1/devices/c1/detections/d1/image');
});
test('Reject cross-device results and Free-range manual data in formal device stats',()=>{
 assert.throws(()=>mapDevice({...rawDevice,latest_detection:{...row,device_id:'other'}}),/another device/);
 assert.throws(()=>mapDevice({...rawDevice,farming_type:'free_range'}),/formal/);
 assert.throws(()=>withDetection(mapDevice(rawDevice),{...mapDetection(row),device_id:'other'}),/another device/);
});
test('Formal snapshot endpoint wins even when manual records could be newer',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(url);return ok({...row,trigger_type:'free_range_snapshot'});});
 const result=await getFreeRangeResults('c1');assert.equal(result.formal.detection_id,'d1');assert.equal(result.manual,null);assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/detections/latest'));
});
test('Null formal snapshot exposes newest manual separately, including zero detections',async t=>{
 t.mock.method(globalThis,'fetch',async url=>url.endsWith('/latest')?ok(null):ok([{...row,detection_id:'zero',normal_count:0,low_count:0,total_count:0,normal_ratio:null,low_ratio:null},row]));
 const result=await getFreeRangeResults('c1');assert.equal(result.formal,null);assert.equal(result.manual.detection_id,'zero');assert.equal(result.manual.total_count,0);
});
test('Unexpected manual result on formal endpoint is an error, not accepted silently',async t=>{
 t.mock.method(globalThis,'fetch',async()=>ok(row));await assert.rejects(getFreeRangeResults('c1'),/formal snapshot/);
});
test('History preserves Backend tie ordering for Previous/Next',async t=>{
 t.mock.method(globalThis,'fetch',async()=>ok([{...row,detection_id:'b'},{...row,detection_id:'a'}]));assert.deepEqual((await getDetectionsByDeviceId('c1')).map(d=>d.detection_id),['b','a']);
});
test('History rejects another device; cannot display its image under current ID',async t=>{
 t.mock.method(globalThis,'fetch',async()=>ok([{...row,device_id:'other'}]));await assert.rejects(getDetectionsByDeviceId('c1'),/mismatch/);
});
test('Home uses Backend summary unchanged rather than summing Offline or manual detections',async t=>{
 const data={cage:{device_count:3,overall_low_ratio:null,normal_device_count:0,warning_device_count:0,offline_device_count:3},free_range:{device_count:1,latest_low_count:0,normal_device_count:0,warning_device_count:0,offline_device_count:1}};
 t.mock.method(globalThis,'fetch',async url=>{assert.ok(url.endsWith('/dashboard/summary'));return ok(data)});assert.deepEqual(await getDashboardSummary(''),data);
});
test('API failures remain failures rather than empty/mock results',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:false,error:{message:'unavailable'},data:null},{status:503}));await assert.rejects(apiGet('/devices'),{status:503});
});
test('Caller cancellation propagates to fetch',async t=>{
 const controller=new AbortController();controller.abort();t.mock.method(globalThis,'fetch',async(_url,options)=>{assert.equal(options.signal.aborted,true);throw new DOMException('Aborted','AbortError');});await assert.rejects(apiGet('/devices',controller.signal),{name:'AbortError'});
});
test('Missing API base has no localhost fallback; non-HTTP media is rejected',()=>{
 assert.throws(()=>resolveBackendUrl('/image',''),/Backend address is not configured/);assert.throws(()=>resolveBackendUrl('file:///photo.jpg'),/Unsupported/);
});
