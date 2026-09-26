import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { validatePhoto, quickMediaUrl, decodeQuickResponse }=await import('../src/services/quickDetectionCore.ts');
test('Reject unsupported formats and oversized images before upload',()=>{
 assert.throws(()=>validatePhoto({uri:'photo.heic',mimeType:'image/heic',fileSize:10}),/JPEG or PNG/);
 assert.throws(()=>validatePhoto({uri:'photo.jpg',mimeType:'image/jpeg',fileSize:11*1024*1024}),/10 MB/);
 assert.equal(validatePhoto({uri:'file:///photo.jpg',mimeType:'image/jpeg',fileSize:100}).type,'image/jpeg');
});
test('Authenticated images cannot leak bearer token to another host',()=>{
 const base='http://backend.test:8006';assert.equal(quickMediaUrl('/api/v1/quick-detections/id/image',base),base+'/api/v1/quick-detections/id/image');
 for(const url of ['https://other.test/image','//other.test/image','/api/v1/devices/id/image','/api/v1/quick-detections/../../other'])assert.throws(()=>quickMediaUrl(url,base));
});
test('Zero targets are successful; request errors and processing remain distinct',()=>{
 const row={status:'succeeded',total_count:0,normal_count:0,low_count:0,normal_ratio:null};assert.deepEqual(decodeQuickResponse(201,{success:true,data:row}),row);
 assert.equal(decodeQuickResponse(202,{success:true,data:{status:'processing'}}).status,'processing');
 assert.throws(()=>decodeQuickResponse(401,{detail:'Session expired'}),{status:401});
 assert.throws(()=>decodeQuickResponse(502,{error:{message:'Analysis failed'}}),{status:502});
});

const {sendQuickUpload}=await import('../src/services/quickUploadTransport.ts');
function fakeXHR(){return {upload:{},headers:{},open(method,url){this.method=method;this.url=url;},setRequestHeader(k,v){this.headers[k]=v;},send(form){this.form=form;},abort(){this.onabort?.();},status:201,responseText:JSON.stringify({success:true,data:{status:'succeeded',total_count:0}})};}
test('Upload uses bearer, stable idempotency key and multipart boundary from runtime',async()=>{
 const xhr=fakeXHR();const progress=[];let verified=0;const form=new FormData();form.append('farming_type','caged');
 const promise=sendQuickUpload(form,'http://localhost/upload','token','same-request',p=>progress.push(p),new AbortController().signal,async()=>{verified++;},()=>xhr);
 assert.equal(xhr.method,'POST');assert.equal(xhr.headers.Authorization,'Bearer token');assert.equal(xhr.headers['Idempotency-Key'],'same-request');assert.equal(xhr.headers['Content-Type'],undefined);assert.equal(xhr.timeout,190000);
 xhr.upload.onprogress({lengthComputable:true,loaded:50,total:100});xhr.upload.onload();assert.deepEqual(progress,[50,100]);await xhr.onload();assert.equal((await promise).total_count,0);assert.equal(verified,1);
});
for(const [event,pattern] of [['onerror',/Network unavailable/],['ontimeout',/timed out/]])test(`Upload ${event} keeps safe retry instructions`,async()=>{
 const xhr=fakeXHR();const promise=sendQuickUpload(new FormData(),'http://localhost/upload','token','retained-key',()=>{},new AbortController().signal,async()=>{},()=>xhr);xhr[event]();await assert.rejects(promise,pattern);assert.equal(xhr.headers['Idempotency-Key'],'retained-key');
});
test('Unmount cancellation aborts upload and account changes reject late success',async()=>{
 const xhr=fakeXHR();const signal=new AbortController();const promise=sendQuickUpload(new FormData(),'url','token','key',()=>{},signal.signal,async()=>{},()=>xhr);signal.abort();await assert.rejects(promise,/interrupted/);
 const later=fakeXHR();const changed=sendQuickUpload(new FormData(),'url','token','key',()=>{},new AbortController().signal,async()=>{throw new Error('Session changed');},()=>later);await later.onload();await assert.rejects(changed,/Session changed/);
});

test('Silent native upload times out, aborts and ignores late success; same key can retry',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const xhr=fakeXHR();let aborted=0;xhr.abort=()=>{aborted++;xhr.onabort?.();};
 const promise=sendQuickUpload(new FormData(),'url','token','retained-key',()=>{},new AbortController().signal,async()=>{},()=>xhr);
 const rejected=assert.rejects(promise,/Upload stalled/);t.mock.timers.tick(20000);await rejected;assert.equal(aborted,1);
 await xhr.onload();assert.equal(xhr.headers['Idempotency-Key'],'retained-key');
 const retry=fakeXHR();const next=sendQuickUpload(new FormData(),'url','token','retained-key',()=>{},new AbortController().signal,async()=>{},()=>retry);await retry.onload();await next;
});
test('Upload progress renews idle timer; analysis has separate hard deadline',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const xhr=fakeXHR();
 const promise=sendQuickUpload(new FormData(),'url','token','key',()=>{},new AbortController().signal,async()=>{},()=>xhr);
 t.mock.timers.tick(15000);xhr.upload.onprogress({lengthComputable:true,loaded:50,total:100});t.mock.timers.tick(15000);xhr.upload.onload();
 const rejected=assert.rejects(promise,/Analysis timed out/);t.mock.timers.tick(160000);await rejected;
});
