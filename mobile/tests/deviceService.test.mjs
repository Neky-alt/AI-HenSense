import './register.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
process.env.EXPO_PUBLIC_API_BASE_URL='http://backend.test:8006';
const svc=await import('../src/services/deviceService.ts');
const { userMessage }=await import('../src/lib/userMessages.ts');
const ok=(data,status=200)=>Response.json({success:true,data,error:null},{status});
const fail=(status,code)=>Response.json({success:false,data:null,error:{code,message:code}},{status});
const created={device_id:'3f1c',farm_id:'f1',device_code:'PI-005',device_name:'Cage C-05',farming_type:'caged',device_status:'offline',last_seen_at:null,is_active:true,latest_detection:null};

test('Device code is trimmed, upper-cased and checked like the Backend',()=>{
 assert.equal(svc.normalizeDeviceCode('  pi-005 '),'PI-005');
 assert.equal(svc.validateDeviceCode(' pi-005 '),null);
 for(const bad of ['','PI','PI_005','PI 005','A'.repeat(33)]) assert.equal(svc.validateDeviceCode(bad)?.field,'device_code');
 assert.equal(svc.validateDeviceName('  Cage  '),null);
 assert.equal(svc.validateDeviceName('   ')?.field,'device_name');
 assert.equal(svc.validateDeviceName('x'.repeat(65))?.field,'device_name');
});

test('Add posts the contract body with the user token and normalized code',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok(created,201);});
 const device=await svc.createDevice({device_code:' pi-005',device_name:' Cage C-05 ',farming_type:'caged'});
 assert.equal(device.device_id,'3f1c');
 assert.equal(calls[0].url,'http://backend.test:8006/api/v1/devices');
 assert.equal(calls[0].init.method,'POST');
 assert.equal(calls[0].init.headers.Authorization,'Bearer fixture-token');
 assert.deepEqual(JSON.parse(calls[0].init.body),{device_code:'PI-005',device_name:'Cage C-05',farming_type:'caged'});
});

test('Add conflicts map to field errors without changing global messages',async t=>{
 for(const [status,code,field] of [[409,'DEVICE_CODE_TAKEN','device_code'],[409,'DEVICE_CODE_RETIRED','device_code'],[422,'INVALID_DEVICE_NAME','device_name'],[422,'INVALID_FARMING_TYPE','farming_type']]){
  t.mock.method(globalThis,'fetch',async()=>fail(status,code));
  const error=await svc.createDevice({device_code:'PI-005',device_name:'A',farming_type:'caged'}).catch(e=>e);
  assert.equal(error.code,code);assert.equal(svc.deviceError(error,'x').field,field);
 }
 const taken=svc.deviceError({status:409,code:'DEVICE_CODE_TAKEN'},'x');assert.equal(taken.message,'This Device ID is already registered.');
 assert.equal(svc.deviceError({status:404,code:'FARM_NOT_FOUND'},'x').message,'You need a farm before adding devices.');
 assert.match(svc.deviceError({status:503,code:'CLOUD_UNAVAILABLE'},'x').message,/Nothing was changed/);
 assert.equal(svc.deviceError({status:422,code:'VALIDATION_ERROR'},'x').message,'Check your input and try again.');
 // Photo upload screens keep their existing 422 wording.
 assert.match(userMessage({status:422,code:'VALIDATION_ERROR'}),/photos/);
 assert.equal(svc.deviceError({status:500},'fallback').field,undefined);
});

test('Rename sends PATCH with only device_name',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok({...created,device_name:'North'});});
 await svc.renameDevice('3f1c',' North ');
 assert.equal(calls[0].url,'http://backend.test:8006/api/v1/devices/3f1c');
 assert.equal(calls[0].init.method,'PATCH');
 assert.deepEqual(JSON.parse(calls[0].init.body),{device_name:'North'});
});

test('Remove keeps history by default; purge is explicit and has no body',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return ok({device_id:'3f1c',is_active:false,history_retained:true});});
 await svc.removeDevice('3f1c');
 await svc.removeDevice('3f1c',{purgeHistory:true});
 assert.equal(calls[0].url,'http://backend.test:8006/api/v1/devices/3f1c');
 assert.equal(calls[1].url,'http://backend.test:8006/api/v1/devices/3f1c?purge_history=true');
 for(const c of calls){assert.equal(c.init.method,'DELETE');assert.equal(c.init.body,undefined);assert.equal(c.init.headers['Content-Type'],undefined);}
});

test('Cloud snapshot mode disables device management with a readable message',async t=>{
 const previous=process.env.EXPO_PUBLIC_DATA_SOURCE;process.env.EXPO_PUBLIC_DATA_SOURCE='cloud';
 t.after(()=>{if(previous===undefined)delete process.env.EXPO_PUBLIC_DATA_SOURCE;else process.env.EXPO_PUBLIC_DATA_SOURCE=previous;});
 assert.equal(svc.deviceManagementEnabled(),false);
 const error=await svc.removeDevice('3f1c').catch(e=>e);
 assert.equal(svc.deviceError(error,'x').message,'This action requires the local Backend.');
});
