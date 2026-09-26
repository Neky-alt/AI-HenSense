import { useEffect } from 'react';
import { router,useLocalSearchParams } from 'expo-router';
import { Pressable,Text,View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { Panel } from '../../components/DesignKit';
import BackendStatus from '../../components/BackendStatus';
import QuickMedia from '../../components/QuickMedia';
import { QuickHeader,quickStyles as s } from '../../components/QuickUI';
import { useAuth } from '../../contexts/AuthContext';
import { useBackendData } from '../../hooks/useBackendData';
import { loadQuickDetail } from '../../services/quickDetectionService';
import { formatRatio } from '../../utils/ratio';
export default function QuickDetail(){
 const {user}=useAuth();const {id}=useLocalSearchParams<{id:string}>();return user?<Detail key={`${user.id}:${id}`} userId={user.id} id={id}/>:null;
}
function Detail({userId,id}:{userId:string;id:string}){
 const state=useBackendData(loadQuickDetail,`${userId}|${id}`);const record=state.data;
 useEffect(()=>{if(record?.status==='processing'){const timer=setTimeout(state.retry,3000);return()=>clearTimeout(timer);}},[record,state.retry]);
 return <AppScreen><QuickHeader/><Text style={s.title}>Quick Detection Result</Text><BackendStatus {...state}/>{record&&<>
 <Text style={s.text}>Phone Upload / Quick Detection · {record.farming_type==='caged'?'Caged':'Free-range'}</Text><Text style={s.text}>{new Date(record.completed_at??record.created_at).toLocaleString('en-AU')} · {record.status==='succeeded'?'Completed':record.status}</Text>
 {record.status==='succeeded'?<><Panel><QuickMedia key={record.quick_detection_id} record={record}/><View style={s.row}>{[['Normal',record.normal_count],['Low',record.low_count],['Total',record.total_count]].map(([label,value])=><View key={String(label)} style={s.count}><Text style={s.text}>{label}</Text><Text style={s.value}>{value}</Text></View>)}</View><Text style={s.text}>Normal Ratio {formatRatio(record.normal_ratio)} · Low Ratio {formatRatio(record.low_ratio)}</Text></Panel>
 {record.total_count===0&&<Text style={s.text}>No chicken heads detected. Zero is a valid result; no detection boxes were added.</Text>}
 {!!record.provenance?.orientation_normalized&&<Text style={s.text}>Original view uses the orientation-corrected image used by AI. The uploaded file is also retained.</Text>}
 <Text style={s.text}>Model classification probabilities are not calibrated confidence or egg-production probability.</Text></>:<Panel><Text style={s.text}>{record.status==='processing'?'AI analysis is still in progress. This page will refresh automatically.':'Analysis failed. Reopen Quick Detection to retry your retained photo safely or select a new photo.'}</Text>{record.status==='failed'&&<Pressable style={s.button} onPress={()=>router.push('/quick-detection')}><Text style={s.buttonText}>Open Quick Detection</Text></Pressable>}</Panel>}
 {record.farming_type==='free_range'&&<Text style={[s.text,{marginTop:10}]}>Single-frame result (at most one detected head), not a count of the whole flock.</Text>}
 <Text style={[s.text,{marginTop:10}]}>Excluded from farm monitoring, formal snapshots and automatic alerts.</Text>
 <View style={[s.row,{justifyContent:'space-between'}]}>{[['Previous',record.previous_id],['Next',record.next_id]].map(([label,target])=><Pressable key={label} disabled={!target} style={[s.button,{opacity:target?1:.4}]} onPress={()=>router.replace(`/quick-detection/${target}`)}><Text style={s.buttonText}>{label}</Text></Pressable>)}</View>
 </>}</AppScreen>;
}
