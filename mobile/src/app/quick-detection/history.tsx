import Ionicons from '@expo/vector-icons/Ionicons';
import { userMessage } from '../../lib/userMessages';
import { historyPaging } from '../../services/quickHistoryPaging';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Alert,Pressable,Text,View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { Panel } from '../../components/DesignKit';
import BackendStatus from '../../components/BackendStatus';
import QuickMedia from '../../components/QuickMedia';
import { QuickHeader,quickStyles as s } from '../../components/QuickUI';
import { useAuth } from '../../contexts/AuthContext';
import { useBackendData } from '../../hooks/useBackendData';
import { deleteQuick,loadQuickHistory } from '../../services/quickDetectionService';
export default function QuickHistory(){const {user}=useAuth();return user?<History key={user.id} userId={user.id}/>:null;}
function History({userId}:{userId:string}){
 const [offset,setOffset]=useState(0);const state=useBackendData(loadQuickHistory,`${userId}|${offset}`);
 const [deleting,setDeleting]=useState<string|null>(null);const [deleteError,setDeleteError]=useState('');const lock=useRef(false);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const paging=historyPaging(offset,state.data?.items.length??0,state.data?.next_offset??null);
 useEffect(()=>{if(!state.loading&&!state.error&&state.data&&paging.emptyPageOffset!==offset)setOffset(paging.emptyPageOffset);},[state.loading,state.error,state.data,paging.emptyPageOffset,offset]);
 const remove=(id:string)=>Alert.alert('Delete detection?', 'This permanently deletes this phone detection and its photos. Device monitoring is not affected.',[
  {text:'Cancel',style:'cancel'}, {text:'Delete',style:'destructive',onPress:()=>{void (async()=>{
   if(lock.current)return;lock.current=true;setDeleting(id);setDeleteError('');
   try{await deleteQuick(id,userId);if(alive.current)state.retry();}
   catch(error){if(alive.current)setDeleteError(userMessage(error,'Unable to delete this record. Please try again.'));}
   finally{lock.current=false;if(alive.current)setDeleting(null);}
  })();}}
 ]);
 return <AppScreen><QuickHeader history={false}/><Text style={s.title}>Quick Detection History</Text><Text style={s.text}>Your phone uploads only. Separate from Device History.</Text><BackendStatus {...state}/>{!!deleteError&&<Text accessibilityRole="alert" style={s.error}>{deleteError}</Text>}
 {!state.loading&&!state.error&&!state.data?.items.length&&<Panel><Text style={s.text}>No phone detections yet.</Text></Panel>}
 {state.data?.items.map(record=><Panel key={record.quick_detection_id}>
 <View style={{alignItems:'flex-end'}}><Pressable accessibilityRole="button" accessibilityLabel="Delete detection" disabled={!!deleting} onPress={()=>remove(record.quick_detection_id)} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:deleting?.length?0.4:1}}><Ionicons name="trash-outline" size={20} color="#B33B32"/></Pressable></View>
 <Pressable accessibilityRole="button" accessibilityLabel="View detection" onPress={()=>router.push(`/quick-detection/${record.quick_detection_id}`)}>
 <QuickMedia key={record.quick_detection_id} record={record} thumbnail/><Text style={[s.buttonText,{marginTop:10}]}>{new Date(record.created_at).toLocaleString('en-AU')}</Text><Text style={s.text}>{record.farming_type==='caged'?'Caged':'Free-range'} · {record.status==='succeeded'?'Completed':record.status==='processing'?'Analyzing':'Failed'}</Text>
 <Text style={s.text}>Normal {record.normal_count??'—'} / Low {record.low_count??'—'} / Total {record.total_count??'—'}</Text></Pressable></Panel>)}
 {paging.showPages&&<><Text style={s.text}>Page {paging.page}</Text><View style={s.row}>
 <Pressable disabled={!offset||state.loading||!!deleting} onPress={()=>setOffset(paging.previous)} style={[s.button,{opacity:offset?1:.4}]}><Text style={s.buttonText}>Previous Page</Text></Pressable>
 <Pressable disabled={state.data?.next_offset==null||state.loading||!!deleting} onPress={()=>setOffset(state.data!.next_offset!)} style={[s.button,{opacity:state.data?.next_offset!=null?1:.4}]}><Text style={s.buttonText}>Next Page</Text></Pressable></View></>}
 <Pressable disabled={state.loading||!!deleting} onPress={state.retry} style={s.button}><Text style={s.buttonText}>Refresh</Text></Pressable>
 </AppScreen>;
}
