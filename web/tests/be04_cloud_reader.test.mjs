/** Offline smoke tests for the explicit cloud read adapter. Requires TypeScript devDependency. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
let ts;
try { ts=require('typescript'); }
catch { ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript')); }

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const farm='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const device='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherFarm='11111111-1111-4111-8111-111111111111';
const otherDevice='22222222-2222-4222-8222-222222222222';
const detection='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
class Query {
  constructor(rows){this.rows=rows;this.sorts=[];this.max=500;}
  select(){return this;}
  eq(field,value){this.rows=this.rows.filter(row=>row[field]===value);return this;}
  in(field,values){this.rows=this.rows.filter(row=>values.includes(row[field]));return this;}
  is(field,value){this.rows=this.rows.filter(row=>row[field]===value);return this;}
  order(field,{ascending=true}={}){this.sorts.push([field,ascending]);return this;}
  limit(max){this.max=max;return this;}
  then(resolve,reject){
    const list=[...this.rows].sort((a,b)=>{
      for(const [key,asc] of this.sorts){const x=String(a[key]??'');const y=String(b[key]??'');if(x!==y)return x<y?(asc?-1:1):(asc?1:-1);}
      return 0;
    }).slice(0,this.max);
    return Promise.resolve({data:list,error:null}).then(resolve,reject);
  }
}
for (const platform of ['web', 'mobile']) {
function fixture({badPath=false,changeUser=false,noFarm=false}={}){
  const user={id:noFarm?'no-farm-user':owner};let checks=0;
  const key=`farms/${farm}/devices/${device}/detections/${detection}/original.jpg`;
  const tables={
    farms:[{farm_id:farm,user_id:owner},{farm_id:otherFarm,user_id:'another-user'}],
    devices:[
      {device_id:device,farm_id:farm,device_code:'FREE-01',device_name:'Free-range 01',farming_type:'free_range',last_seen_at:null,is_active:true},
      {device_id:otherDevice,farm_id:otherFarm,device_code:'PRIVATE',farming_type:'caged',last_seen_at:null,is_active:true},
    ],
    detections:[
      {detection_id:detection,device_id:device,detected_at:'2026-09-24T12:00:00Z',created_at:'2026-09-24T12:00:00Z',trigger_type:'free_range_snapshot',total_count:4,low_count:2,normal_count:2,normal_ratio:.5,low_ratio:.5,monitoring_status:'warning',image_deleted_at:null,deleted_at:null,image_url:badPath?`farms/${otherFarm}/evil.jpg`:key,annotated_image_path:null},
      {detection_id:'33333333-3333-4333-8333-333333333333',device_id:device,detected_at:'2026-09-24T13:00:00Z',created_at:'2026-09-24T13:00:00Z',trigger_type:'manual',total_count:1,normal_count:1,low_count:0,monitoring_status:'normal',image_deleted_at:null,deleted_at:null,image_url:null,annotated_image_path:null},
      {detection_id:'44444444-4444-4444-8444-444444444444',device_id:device,detected_at:'2026-09-24T14:00:00Z',created_at:'2026-09-24T14:00:00Z',trigger_type:'manual',total_count:0,normal_count:0,low_count:0,monitoring_status:'normal',image_deleted_at:null,deleted_at:'2026-09-24T15:00:00Z',image_url:null,annotated_image_path:null},
    ],
    alerts:[],
  };
  const supabase={
    auth:{getUser:async()=>({data:{user:(changeUser&&++checks>1)?{id:'changed-user'}:user},error:null})},
    from:table=>({select:()=>new Query(tables[table]??[])}),
    storage:{from:bucket=>({createSignedUrl:async key=>({data:{signedUrl:`https://project.supabase.co/storage/v1/object/sign/${bucket}/${key}?token=test`},error:null})})},
  };
  const source=fs.readFileSync(new URL(`../../${platform}/src/services/be04CloudApi.ts`,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(compiled,{module,exports:module.exports,require:()=>({supabase}),URL,Date,Error,Promise,console}, {filename:'be04CloudApi.js'});
  return module.exports;
}
test(platform + ': ' + 'only the signed-in user farm is returned, free-range uses latest formal snapshot',async()=>{
  const devices=await fixture().be04CloudGet('/devices');
  assert.equal(devices.length,1);assert.equal(devices[0].device_id,device);
  assert.equal(devices[0].latest_detection.detection_id,detection);
  assert.match(devices[0].latest_detection.image_url,/\/object\/sign\/detection-images\//);
  assert.equal(devices[0].device_status,'offline');
});
test(platform + ': ' + 'soft-deleted history is excluded',async()=>{
  const rows=await fixture().be04CloudGet(`/devices/${device}/detections`);
  assert.equal(rows.length,2);assert.equal(rows.some(row=>row.deleted_at),false);
});
test(platform + ': ' + 'other-user device and cross-farm object path fail closed',async()=>{
  await assert.rejects(fixture().be04CloudGet(`/devices/${otherDevice}`),/not found/);
  await assert.rejects(fixture({badPath:true}).be04CloudGet('/devices'),/Unexpected cloud media path/);
});
test(platform + ': ' + 'account switch during request rejects the result',async()=>{
  await assert.rejects(fixture({changeUser:true}).be04CloudGet('/devices'),/Account changed/);
});

test(platform + ': account without a farm receives an empty list',async()=>{
 const api=fixture({noFarm:true});assert.equal((await api.be04CloudGet('/devices')).length,0);
 await assert.rejects(api.be04CloudGet(`/devices/${device}`),/not found/);
});

}
