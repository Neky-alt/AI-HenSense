import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function setup(platform,mode='local'){
 const root=new URL(platform==='web'?'../src/':'../../mobile/src/',import.meta.url);let session={user:{id:'A'},access_token:'token-A'};let listener;let fetchImpl=async()=>({ok:true,json:async()=>({success:true,data:['A']})});let cloudCalls=0;
 const auth={onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){}}}};},async getSession(){return {data:{session},error:null};}};
 const cache={};
 function load(name){
  if(name.includes('supabase'))return {supabase:{auth}};
  if(name.includes('be04CloudApi'))return {be04CloudGet:async()=>{cloudCalls++;return ['cloud'];}};
  const file=name.includes('accountRequest')?'services/accountRequest.ts':name.includes('userMessages')?'lib/userMessages.ts':'services/apiClient.ts';
  if(cache[file])return cache[file];
  let source=fs.readFileSync(new URL(file,root),'utf8').replaceAll('import.meta.env',JSON.stringify({VITE_DATA_SOURCE:mode,VITE_API_BASE_URL:'http://local.test'}));
  const exports={};cache[file]=exports;
  vm.runInNewContext(ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{exports,require:load,console,URL,AbortController,AbortSignal,setTimeout,clearTimeout,process:{env:{EXPO_PUBLIC_DATA_SOURCE:mode,EXPO_PUBLIC_API_BASE_URL:'http://local.test'}},fetch:(...args)=>fetchImpl(...args)});
  return exports;
 }
 const api=load('apiClient');
 return {api,setFetch:fn=>{fetchImpl=fn},switch(id){session=id?{user:{id},access_token:'token-'+id}:null;listener(id?'SIGNED_IN':'SIGNED_OUT',session);},cloudCalls:()=>cloudCalls};
}
for(const platform of ['web','mobile']){
 test(`${platform}: Local sends actual token; logout/switch rejects late results`,async()=>{
  const s=setup(platform);let finish;let started;const begun=new Promise(r=>started=r);
  s.setFetch(async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer token-A');started();await new Promise(r=>finish=r);return {ok:true,json:async()=>({success:true,data:['private-A']})};});
  const pending=s.api.apiGet('/devices');await begun;s.switch('B');finish();await assert.rejects(pending,/Session changed/);
  s.switch(null);await assert.rejects(s.api.apiGet('/devices'),/sign in again/i);
 });
 test(`${platform}: Local/Cloud routing is explicit and never falls back to anonymous Local`,async()=>{
  const s=setup(platform,'cloud');s.setFetch(()=>{throw new Error('Local fallback forbidden');});
  assert.deepEqual(Array.from(await s.api.apiGet('/devices')),['cloud']);assert.equal(s.cloudCalls(),1);
  s.switch(null);await assert.rejects(s.api.apiGet('/devices'));assert.equal(s.cloudCalls(),1);
 });
 test(`${platform}: leaving and returning to same account invalidates in-flight result`,async()=>{
  const s=setup(platform);let finish;let start;const ready=new Promise(r=>start=r);
  s.setFetch(async()=>{start();await new Promise(r=>finish=r);return {ok:true,json:async()=>({success:true,data:[]})};});
  const pending=s.api.apiGet('/devices');await ready;s.switch(null);s.switch('A');finish();await assert.rejects(pending,/Session changed/);
 });
}
