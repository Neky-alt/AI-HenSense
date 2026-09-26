import { decodeQuickResponse } from './quickDetectionCore';
import type { QuickDetection } from '../types/quickDetection';
export const UPLOAD_IDLE_MS = 20000;
export const ANALYSIS_TIMEOUT_MS = 190000;
export function sendQuickUpload(form: FormData,url: string,token: string,requestId: string,onProgress:(percent:number|null)=>void,signal:AbortSignal,verifySession:()=>Promise<unknown>,createXHR:()=>XMLHttpRequest=()=>new XMLHttpRequest()):Promise<QuickDetection>{
 return new Promise((resolve,reject)=>{
  const xhr=createXHR();let settled=false;let loaded=0;
  let idle:ReturnType<typeof setTimeout>;let deadline:ReturnType<typeof setTimeout>;
  const cleanup=()=>{clearTimeout(idle);clearTimeout(deadline);signal.removeEventListener('abort',abort);};
  const fail=(message:string,error?:unknown)=>{if(settled)return;settled=true;cleanup();reject(error ?? new Error(message));xhr.abort();};
  const abort=()=>fail('Upload interrupted. Check History before starting another detection.');
  const resetIdle=()=>{clearTimeout(idle);idle=setTimeout(()=>fail('Upload stalled. Check your connection, then check History or retry the same photo safely.'),UPLOAD_IDLE_MS);};
  xhr.open('POST',url);xhr.timeout=ANALYSIS_TIMEOUT_MS;
  xhr.setRequestHeader('Authorization',`Bearer ${token}`);xhr.setRequestHeader('Idempotency-Key',requestId);
  xhr.upload.onprogress=e=>{if(settled)return;if(e.loaded>loaded){loaded=e.loaded;resetIdle();}if(e.lengthComputable&&e.total>0&&e.loaded>=e.total)clearTimeout(idle);onProgress(e.lengthComputable?Math.round(e.loaded/e.total*100):null);};
  xhr.upload.onload=()=>{if(!settled){clearTimeout(idle);onProgress(100);}};
  xhr.onload=async()=>{if(settled)return;clearTimeout(idle);try{const result=decodeQuickResponse(xhr.status,JSON.parse(xhr.responseText)) as QuickDetection;await verifySession();if(!settled){settled=true;cleanup();resolve(result);}}catch(e){fail('Upload failed. Retry the same photo safely.',e);}};
  xhr.onerror=()=>fail('Network unavailable. Check History or retry the same photo safely.');
  xhr.ontimeout=()=>fail('Analysis timed out. It may still complete. Check History or retry the same photo safely.');
  xhr.onabort=abort;
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort);resetIdle();
  // Independent JS deadline also covers native XHR implementations that omit timeout events.
  deadline=setTimeout(()=>fail('Analysis timed out. It may still complete. Check History or retry the same photo safely.'),ANALYSIS_TIMEOUT_MS);
  try{xhr.send(form);}catch(e){fail('Upload failed. Retry the same photo safely.',e);}
 });
}
