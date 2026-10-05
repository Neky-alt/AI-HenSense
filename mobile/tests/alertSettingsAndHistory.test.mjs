import './register.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
process.env.EXPO_PUBLIC_API_BASE_URL='http://backend.test:8006';
const settings=await import('../src/services/settingsService.ts');
const detections=await import('../src/services/detectionService.ts');
const ok=data=>Response.json({success:true,data,error:null});
const row={detection_id:'d1',device_id:'c1',detected_at:'2026-09-24T10:00:00Z',trigger_type:'manual',capture_source_type:'pi_camera',normal_count:8,low_count:2,total_count:10,normal_ratio:.8,low_ratio:.2,monitoring_status:'normal',confidence:null,image_url:null,annotated_image_url:null,image_path:null,image_deleted_at:'2026-10-05T00:00:00Z'};

test('Alert setting reads the in-app switch from the Backend',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok({user_id:'u',in_app_enabled:false,email_enabled:false,push_enabled:false});});
 assert.deepEqual(await settings.getAlertNotificationSettings(),{in_app_enabled:false});
 assert.equal(calls[0].url,'http://backend.test:8006/api/v1/notification-settings');
});

test('Saving the alert setting keeps email and push off, like Web',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok({user_id:'u',in_app_enabled:true,email_enabled:false,push_enabled:false});});
 assert.deepEqual(await settings.saveAlertNotificationSettings({in_app_enabled:true}),{in_app_enabled:true});
 assert.equal(calls[0].init.method,'PUT');
 assert.deepEqual(JSON.parse(calls[0].init.body),{in_app_enabled:true,email_enabled:false,push_enabled:false});
});

test('Delete image keeps the record and returns it without media',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok(row);});
 const d=await detections.deleteDetectionImage('c1','d1');
 assert.equal(calls[0].url,'http://backend.test:8006/api/v1/devices/c1/detections/d1/image');
 assert.equal(calls[0].init.method,'DELETE');
 assert.equal(d.detection_id,'d1');assert.equal(d.total_count,10);assert.equal(d.screenshot_url,null);assert.equal(d.annotated_image_url,null);
});

test('Delete record calls the record endpoint',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok({detection_id:'d1',deleted:true});});
 assert.deepEqual(await detections.deleteDetectionRecord('c1','d1'),{detection_id:'d1',deleted:true});
 assert.equal(calls[0].url,'http://backend.test:8006/api/v1/devices/c1/detections/d1');
 assert.equal(calls[0].init.method,'DELETE');assert.equal(calls[0].init.body,undefined);
});
