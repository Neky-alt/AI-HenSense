import DevicePhoto from '../../components/DevicePhoto';
import BackendStatus from '../../components/BackendStatus';
import { useBackendData } from '../../hooks/useBackendData';
import { getDashboardSummary } from '../../services/detectionService';
import { formatDeviceUpdate } from '../../utils/time';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import FarmHero from '../../components/FarmHero';
import AlertCard from '../../components/AlertCard';
import { ActionLink, Panel, PanelTitle, StatTile, Pill } from '../../components/DesignKit';
import { COLORS } from '../../constants/theme';
import { getAlerts } from '../../services/detectionService';
import { getDashboardPreferences, saveDashboardPreferences, type DashboardPreferences } from '../../services/dashboardPreferenceService';
import { getDevices } from '../../services/deviceStorage';
import type { Device, FarmingType } from '../../types/device';

import { formatRatio } from '../../utils/ratio';

const MAX=2;
async function loadHome(id:string,signal:AbortSignal){const [devices,prefs,summary,alerts]=await Promise.all([getDevices(id,signal),getDashboardPreferences(),getDashboardSummary(id,signal),getAlerts(id,signal)]);return {devices,prefs,summary,alerts};}
export default function HomeScreen(){
 const state=useBackendData(loadHome);
 const devices=state.data?.devices??[];
 const [prefs,setPrefs]=useState<DashboardPreferences|null>(null);
 const [draft,setDraft]=useState<DashboardPreferences>({cage_device_ids:[],free_range_device_ids:[]});
 const [pickerOpen,setPickerOpen]=useState(false);
 const cages=useMemo(()=>devices.filter(d=>d.farming_type==='caged'),[devices]);
 const free=useMemo(()=>devices.filter(d=>d.farming_type==='free_range'),[devices]);
 const cageSummary=state.data?.summary.cage;
 const rangeSummary=state.data?.summary.free_range;
 const cage={count:cageSummary?.device_count??'—',ratio:cageSummary?.overall_low_ratio??null,normal:cageSummary?.normal_device_count??'—',warning:cageSummary?.warning_device_count??'—',offline:cageSummary?.offline_device_count??'—'};
 const range={count:rangeSummary?.device_count??'—',low:rangeSummary?.latest_low_count??'—',normal:rangeSummary?.normal_device_count??'—',warning:rangeSummary?.warning_device_count??'—',offline:rangeSummary?.offline_device_count??'—'};
 const defaults:DashboardPreferences={cage_device_ids:cages.slice(0,2).map(d=>d.device_id),free_range_device_ids:free.slice(0,2).map(d=>d.device_id)};
 const saved=prefs??state.data?.prefs;
 const reconcile=(ids:string[]|undefined,list:Device[],fallback:string[])=>ids===undefined?fallback:ids.length===0?[]:ids.some(id=>list.some(d=>d.device_id===id))?ids.filter(id=>list.some(d=>d.device_id===id)):fallback;
 const effective={cage_device_ids:reconcile(saved?.cage_device_ids,cages,defaults.cage_device_ids),free_range_device_ids:reconcile(saved?.free_range_device_ids,free,defaults.free_range_device_ids)};
 const pick=(list:Device[],ids:string[])=>ids.map(id=>list.find(d=>d.device_id===id)).filter((d):d is Device=>!!d);
 const openPicker=()=>{setDraft({cage_device_ids:[...effective.cage_device_ids],free_range_device_ids:[...effective.free_range_device_ids]});setPickerOpen(true)};
 const toggle=(d:Device)=>{const key=d.farming_type==='caged'?'cage_device_ids':'free_range_device_ids';setDraft(cur=>{const existing=cur[key];if(existing.includes(d.device_id))return{...cur,[key]:existing.filter(id=>id!==d.device_id)};if(existing.length>=MAX)return cur;return{...cur,[key]:[...existing,d.device_id]}})};
 const save=async()=>{try{await saveDashboardPreferences(draft);setPrefs(draft);setPickerOpen(false)}catch{Alert.alert('Unable to save selection','Please try again.')}};
 const alerts=state.data?.alerts??[];
 // Distinct navigation parameters let the target tab apply a fresh filter even when mounted.
 const openCage=(filter:'all'|'normal'|'warning'|'offline',sort:'default'|'low-desc'='default')=>
   router.push({pathname:'/cage',params:{cwFilter:filter,cwSort:sort,cwNavId:String(Date.now())}});
 const openRange=(filter:'all'|'normal'|'warning'|'offline')=>
   router.push({pathname:'/free-range',params:{cwFilter:filter,cwNavId:String(Date.now())}});
 // The header reflects the latest known detection timestamp, not the screen refresh time.
 const latestDetectionAt=devices.filter(d=>d.latest_detection_id && d.detected_at && Number.isFinite(Date.parse(d.detected_at))).map(d=>d.detected_at!).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
 return <AppScreen>
   <FarmHero home updatedAt={latestDetectionAt} alertCount={alerts.filter(a=>a.alert_status==='active').length}/>{process.env.EXPO_PUBLIC_DATA_SOURCE==='cloud'&&<Text style={{fontSize:11,color:COLORS.textSecondary,marginBottom:10}}>Cloud snapshot · last synced results, not a live camera feed.</Text>}<BackendStatus {...state}/>
   <Panel><PanelTitle title="Cage Monitoring Summary" icon="grid-outline" compact right={<ActionLink title="View all" compact onPress={()=>openCage('all')}/>}/>
     <View style={s.tiles}>
       <StatTile label="Devices" weight={1} value={cage.count} icon="hardware-chip-outline" tone="blue" onPress={()=>openCage('all')}/>
       <StatTile label="Low-production Ratio" weight={2.25} emphasis value={formatRatio(cage.ratio)} icon="stats-chart-outline" tone="purple" onPress={()=>openCage('all','low-desc')}/>
       <StatTile label="Normal" weight={1} value={cage.normal} icon="checkmark-circle-outline" tone="green" onPress={()=>openCage('normal')}/>
       <StatTile label="Warning" weight={1} value={cage.warning} icon="warning-outline" tone="red" onPress={()=>openCage('warning')}/>
       <StatTile label="Offline" weight={1} value={cage.offline} icon="cloud-offline-outline" tone="gray" onPress={()=>openCage('offline')}/>
     </View>
   </Panel>
   <Panel><PanelTitle title="Free-range Monitoring Summary" icon="leaf-outline" compact right={<ActionLink title="View all" compact onPress={()=>openRange('all')}/>}/>
     <View style={s.tiles}>
       <StatTile label="Devices" weight={1} value={range.count} icon="hardware-chip-outline" tone="blue" onPress={()=>openRange('all')}/>
       <StatTile label="Latest Low Count" weight={2.25} emphasis value={range.low} icon="stats-chart-outline" tone="purple" onPress={()=>openRange('all')}/>
       <StatTile label="Normal" weight={1} value={range.normal} icon="checkmark-circle-outline" tone="green" onPress={()=>openRange('normal')}/>
       <StatTile label="Warning" weight={1} value={range.warning} icon="warning-outline" tone="red" onPress={()=>openRange('warning')}/>
       <StatTile label="Offline" weight={1} value={range.offline} icon="cloud-offline-outline" tone="gray" onPress={()=>openRange('offline')}/>
     </View>
   </Panel>
   <Panel><PanelTitle title="Recent Alerts" icon="notifications-outline" right={<ActionLink title="View all" onPress={()=>router.push('/alerts')}/>}/>{!state.loading&&!state.error&&!alerts.length&&<Text style={s.empty}>No alerts right now.</Text>}{alerts.slice(0,3).map(a=><AlertCard key={a.alert_id} alert={a} device={devices.find(d=>d.device_id===a.device_id)} compact/>)}</Panel>
   <Panel><PanelTitle title="Quick Monitoring" icon="grid-outline" subtitle="Your selected monitoring devices" right={<Pressable onPress={openPicker} style={s.customize}><Ionicons name="options-outline" size={15} color={COLORS.primaryDark}/><Text style={s.customizeText}>Customize</Text></Pressable>}/>
     <Text style={s.groupTitle}>Cage Monitoring</Text><QuickGroup ready={!state.loading&&!state.error} all={cages} picked={pick(cages,effective.cage_device_ids)} kind="cage"/>
     <Text style={s.groupTitle}>Free-range Monitoring</Text><QuickGroup ready={!state.loading&&!state.error} all={free} picked={pick(free,effective.free_range_device_ids)} kind="free-range"/>
   </Panel>
   <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={()=>setPickerOpen(false)}><View style={s.modalBack}><View style={s.modal}><View style={s.modalHead}><Text style={s.modalTitle}>Customize Quick Monitoring</Text><Pressable onPress={()=>setPickerOpen(false)}><Ionicons name="close" size={23} color={COLORS.text}/></Pressable></View><Text style={s.modalSub}>Choose up to two devices per farming type.</Text><ScrollView>{(['caged','free_range'] as FarmingType[]).map(type=><View key={type}><Text style={s.groupTitle}>{type==='caged'?'Cage':'Free-range'}</Text>{(type==='caged'?cages:free).map(d=>{const key=type==='caged'?'cage_device_ids':'free_range_device_ids';const selected=draft[key].includes(d.device_id);return <Pressable key={d.device_id} onPress={()=>toggle(d)} style={[s.option,selected&&s.selectedOption]}><Ionicons name={selected?'checkbox':'square-outline'} size={20} color={COLORS.primaryDark}/><Text style={s.optionName}>{d.device_name}</Text></Pressable>})}</View>)}</ScrollView><View style={s.modalActions}><Pressable onPress={()=>setDraft(defaults)}><Text style={s.reset}>Use defaults</Text></Pressable><Pressable onPress={save} style={s.save}><Text style={s.saveText}>Save selection</Text></Pressable></View></View></View></Modal>
 </AppScreen>
}
function QuickCard({device:d}:{device:Device}){const unavailable=!d.latest_detection_id;const disconnected=d.device_status!=='online';return <Pressable onPress={()=>router.push(`/device/${d.device_id}`)} style={s.quickCard}><View style={s.quickImage}><DevicePhoto device={d} height={58}/></View><View style={s.quickCopy}><Text style={s.quickName} numberOfLines={1}>{d.device_name}</Text><Text style={s.quickCode}>{d.device_code}</Text><Pill text={disconnected?(d.device_status==='offline'?'Offline':'Error'):(d.monitoring_status==='warning'?'Warning':d.monitoring_status==='normal'?'Normal':'No result')} tone={d.device_status==='offline'?'gray':d.device_status==='error'||d.monitoring_status==='warning'?'red':'green'}/></View><Text style={[s.quickCode,{width:'100%',marginTop:5}]}>{d.latest_detection_id?(disconnected?'Last Recorded Result · ':'Recorded Result · '):'No recorded result · '}{formatDeviceUpdate(d.detected_at)}</Text><Text style={s.quickCode}>{formatRatio(d.normal_ratio)} normal · {formatRatio(d.low_ratio)} low</Text><View style={s.quickStats}><MiniStat label="Normal" value={unavailable?'—':d.normal_count} color={COLORS.normal}/><MiniStat label="Low" value={unavailable?'—':d.low_count} color={COLORS.danger}/><MiniStat label="Total" value={unavailable?'—':d.total_count} color={COLORS.text}/></View></Pressable>}
function QuickGroup({ready,all,picked,kind}:{ready:boolean;all:Device[];picked:Device[];kind:string}){
 if(picked.length)return <View style={s.quickRow}>{picked.map(d=><QuickCard key={d.device_id} device={d}/>)}</View>;
 if(!ready)return null;
 return <Text style={s.empty}>{all.length?'No devices selected. Use Customize to choose up to two.':`No ${kind} devices yet.`}</Text>;
}
function MiniStat({label,value,color}:{label:string;value:string|number;color:string}){return <View style={{alignItems:'center',flex:1}}><Text style={s.statLabel}>{label}</Text><Text style={[s.statValue,{color}]}>{value}</Text></View>}
const s=StyleSheet.create({tiles:{flexDirection:'row',gap:3},empty:{fontSize:11,color:COLORS.textSecondary,paddingVertical:8,marginBottom:6},customize:{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:COLORS.primarySoft,borderRadius:10,paddingHorizontal:10,paddingVertical:9},customizeText:{fontSize:10.5,fontWeight:'800',color:COLORS.primaryDark},groupTitle:{fontSize:12,fontWeight:'900',color:COLORS.text,marginVertical:9},quickRow:{flexDirection:'row',gap:9,marginBottom:12},quickCard:{flex:1,minWidth:0,borderRadius:13,padding:7,borderWidth:1,borderColor:COLORS.border,backgroundColor:'#fff',flexDirection:'row',flexWrap:'wrap',alignItems:'center'},quickImage:{width:52,height:58,borderRadius:10},quickCopy:{flex:1,minWidth:0,marginLeft:7,justifyContent:'center',gap:3},quickName:{fontSize:10.8,fontWeight:'900',color:COLORS.text},quickCode:{fontSize:9,color:COLORS.textSecondary},quickStats:{width:'100%',flexDirection:'row',borderTopWidth:1,borderTopColor:COLORS.border,marginTop:8,paddingTop:8},statLabel:{fontSize:9,color:COLORS.textSecondary},statValue:{fontSize:14,fontWeight:'900',marginTop:2},modalBack:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(10,24,16,.45)'},modal:{padding:18,maxHeight:'80%',backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24},modalHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},modalTitle:{fontSize:19,fontWeight:'900',color:COLORS.text},modalSub:{fontSize:11,color:COLORS.textSecondary,marginTop:5,marginBottom:10},option:{padding:11,borderWidth:1,borderColor:COLORS.border,borderRadius:11,marginBottom:7,flexDirection:'row',alignItems:'center',gap:9},selectedOption:{backgroundColor:COLORS.primarySoft,borderColor:'#E8CA7B'},optionName:{fontSize:12,fontWeight:'700',color:COLORS.text},modalActions:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:12},reset:{fontSize:12,color:COLORS.textSecondary,fontWeight:'700'},save:{backgroundColor:COLORS.primary,borderRadius:11,paddingHorizontal:17,paddingVertical:12},saveText:{fontSize:12,fontWeight:'900',color:COLORS.onPrimary}});
