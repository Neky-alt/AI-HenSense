import { serviceError } from '../lib/userMessages';
import type { QuickPhoto } from '../types/quickDetection';
export function validatePhoto(photo: QuickPhoto) {
 if(photo.fileSize && photo.fileSize>10*1024*1024) throw new Error('Choose an image smaller than 10 MB.');
 const ext=photo.uri.split('?')[0].toLowerCase();
 const type=photo.mimeType || (ext.endsWith('.png')?'image/png':/\.jpe?g$/.test(ext)?'image/jpeg':'');
 if(!['image/jpeg','image/png'].includes(type)) throw new Error('Choose a JPEG or PNG photo. HEIC is not supported; use a compatible exported image.');
 return {uri:photo.uri,type,name:type==='image/png'?'photo.png':'photo.jpg'};
}
export function quickMediaUrl(path: string,base: string) {
 if(!/^\/api\/v1\/quick-detections\/[a-zA-Z0-9-]+\/(image|annotated-image)$/.test(path)) throw new Error('Invalid private image URL.');
 return new URL(path,base).toString();
}
export function decodeQuickResponse(status: number,body: {success?:boolean;data?:unknown;error?:{message?:string;code?:string};detail?:unknown}): unknown {
 if(status<200||status>=300||!body.success)throw serviceError(status, body.error?.code || (typeof body.detail==='object' && body.detail ? (body.detail as {code?:string}).code : undefined));
 return body.data;
}
