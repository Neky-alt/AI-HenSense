import { supabase } from '../lib/supabase';
let owner: string | null = null;
let revision = 0;
supabase?.auth.onAuthStateChange((event,session)=>{
 const next=session?.user.id??null;
 if(next!==owner || event==='SIGNED_OUT'){owner=next;revision++;}
});
export async function accountRequest(){
 if(!supabase)throw new Error('Please sign in again.');
 const {data,error}=await supabase.auth.getSession();
 if(error||!data.session)throw new Error('Please sign in again.');
 const userId=data.session.user.id;const token=data.session.access_token;const version=revision;
 if(owner!==null && owner!==userId)throw new Error('Session changed. Sign in again.');
 return {userId,token,async check(){
  const {data}=await supabase!.auth.getSession();
  if(version!==revision||data.session?.user.id!==userId)throw new Error('Session changed. Sign in again.');
 }};
}
