import { sendQuickUpload } from './quickUploadTransport';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { resolveBackendUrl } from './apiClient';
import { decodeQuickResponse, validatePhoto } from './quickDetectionCore';
import type { QuickDetection, QuickDraft } from '../types/quickDetection';
export async function accessToken(userId: string) {
 let timer:ReturnType<typeof setTimeout> | undefined;
 const {data,error}=await Promise.race([supabase!.auth.getSession(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Connection timed out. Check your connection and retry the same photo safely.')),20000);})]).finally(()=>clearTimeout(timer));
 if(error||!data.session||data.session.user.id!==userId)throw new Error('Session changed. Sign in again.');
 return data.session.access_token;
}
export async function quickGet<T>(path: string,userId: string,signal?: AbortSignal,method: 'GET'|'DELETE'='GET'):Promise<T> {
 const token=await accessToken(userId);const controller=new AbortController();const abort=()=>controller.abort();
 signal?.addEventListener('abort',abort);if(signal?.aborted)controller.abort();
 const timer=setTimeout(abort,20000);
 try{const r=await fetch(resolveBackendUrl(`/api/v1/quick-detections${path}`),{method,headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'});const result=decodeQuickResponse(r.status,await r.json()) as T;await accessToken(userId);return result;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
// Hook keys include the signed-in user: never reuse data between accounts.
export const loadQuickHistory=(key:string,signal:AbortSignal)=>{const [user,offset]=key.split('|');return quickGet<{items:QuickDetection[];next_offset:number|null}>(`?offset=${Number(offset)||0}`,user,signal);};
export const loadQuickDetail=(key:string,signal:AbortSignal)=>{const [user,id]=key.split('|');return quickGet<QuickDetection>(`/${encodeURIComponent(id)}`,user,signal);};
export const draftKey=(user:string)=>`@hensense/quick-draft/${user}`;
export async function readDraft(user:string):Promise<QuickDraft|null>{const raw=await AsyncStorage.getItem(draftKey(user));return raw?JSON.parse(raw):null;}
export const saveDraft=(user:string,draft:QuickDraft)=>AsyncStorage.setItem(draftKey(user),JSON.stringify(draft));
export const clearDraft=(user:string)=>AsyncStorage.removeItem(draftKey(user));
export async function uploadQuick(draft:QuickDraft,user:string,onProgress:(percent:number|null)=>void,signal:AbortSignal):Promise<QuickDetection>{
 const photo=validatePhoto(draft.photo);const token=await accessToken(user);const form=new FormData();
 if(Platform.OS==='web'){
  const blob=await (await fetch(photo.uri,{signal})).blob();form.append('file',blob,photo.name);
 }else{form.append('file',photo as unknown as Blob);}
 form.append('farming_type',draft.mode);form.append('source_type',draft.source);
 return sendQuickUpload(form,resolveBackendUrl('/api/v1/quick-detections'),token,draft.requestId,onProgress,signal,()=>accessToken(user));
}

export async function deleteQuick(id:string,userId:string){
 try{return await quickGet<{deleted:boolean}>(`/${encodeURIComponent(id)}`,userId,undefined,'DELETE');}
 catch(error){if((error as {status?:number})?.status===404)return {deleted:true};throw error;}
}
