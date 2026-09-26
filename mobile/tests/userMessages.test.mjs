import './register.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
const {userMessage,serviceError}=await import('../src/lib/userMessages.ts');
test('Never display arbitrary third-party text or stack; use status/code mappings',()=>{
 assert.equal(userMessage(new Error('中文内部错误 SQL stack'),'Try again.'),'Try again.');
 assert.match(userMessage({code:'over_email_send_rate_limit',message:'中文'}),/Too many email/);
 assert.match(userMessage({code:'invalid_credentials'}),/Incorrect email/);
 assert.match(userMessage({code:'otp_expired'}),/invalid or expired/);
 assert.match(userMessage(serviceError(415)),/JPEG or PNG/);
 assert.match(userMessage({code:'DELETE_BUSY'}),/still being analyzed/);
 assert.match(userMessage({code:'DELETE_CLEANUP_PENDING'}),/retry deleting/);
 assert.match(userMessage(new Error('Network request failed')),/Unable to connect/);
 assert.match(userMessage(new Error('Camera permission was denied. You can enable it in Settings.')),/Settings/);
});
const {historyPaging}=await import('../src/services/quickHistoryPaging.ts');
test('History hides single-page pagination and returns from an emptied last page',()=>{
 assert.equal(historyPaging(0,0,null).showPages,false);assert.equal(historyPaging(0,30,null).showPages,false);
 assert.equal(historyPaging(0,30,30).showPages,true);assert.equal(historyPaging(30,1,null).page,2);
 assert.equal(historyPaging(30,0,null).emptyPageOffset,0);assert.equal(historyPaging(60,0,null).emptyPageOffset,30);
 assert.equal(historyPaging(30,1,null).emptyPageOffset,30);
});
