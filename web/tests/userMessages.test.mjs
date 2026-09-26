import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/userMessages.ts',import.meta.url),'utf8');
const {userMessage,serviceError}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64'));
test('Web errors use English code/status mapping, never arbitrary service messages',()=>{
 assert.equal(userMessage({message:'中文错误 stack',code:'unknown'},'Please try again.'),'Please try again.');
 assert.match(userMessage({code:'over_email_send_rate_limit'}),/Too many email/);assert.match(userMessage({code:'weak_password'}),/stronger password/);
 assert.match(userMessage(serviceError(401,'UNAUTHORIZED')),/sign in again/);
 assert.equal(serviceError(503,'UNAVAILABLE').code,'UNAVAILABLE');
});
test('Auth forms own their English validation instead of browser-localized popups',()=>{
 for(const page of ['Login','Register','PasswordRecovery']){
  const text=fs.readFileSync(new URL(`../src/pages/${page}.tsx`,import.meta.url),'utf8');assert.match(text,/<form noValidate/);assert.match(text,/Enter a valid email address/);
 }
});
