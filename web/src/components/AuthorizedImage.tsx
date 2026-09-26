import { useEffect,useState } from 'react';
import { accountRequest } from '../services/accountRequest';
import { API_BASE_URL } from '../services/apiClient';
import { useAuth } from '../contexts/AuthContext';
export function isLocalMedia(src:string){
 try{const url=new URL(src,window.location.origin);return url.origin===new URL(API_BASE_URL).origin&&/^\/api\/v1\/devices\/[^/]+\/detections\/[^/]+\/(image|annotated-image)$/.test(url.pathname);}catch{return false;}
}
export default function AuthorizedImage({src,alt,className,onError}:{src:string;alt:string;className:string;onError:()=>void}){
 const {user}=useAuth();const [value,setValue]=useState<{key:string;url:string}>();const key=`${user?.id}:${src}`;
 const local=isLocalMedia(src);
 useEffect(()=>{
  if(!local)return;
  const controller=new AbortController();let objectUrl:string|undefined;
  void (async()=>{try{
   const account=await accountRequest();const response=await fetch(src,{headers:{Authorization:`Bearer ${account.token}`},signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw new Error('Image unavailable');const blob=await response.blob();await account.check();
   if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setValue({key,url:objectUrl});
  }catch{if(!controller.signal.aborted)onError();}})();
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 // onError belongs to the owning image state; avoid refetch on every parent render.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[src,key,local]);
 if(!user)return null;
 const url=local?(value?.key===key?value.url:undefined):src;
 return url?<img src={url} alt={alt} className={className} onError={onError}/>:<div className={className} aria-label="Loading image"/>;
}
