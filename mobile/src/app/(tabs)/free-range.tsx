import BackendStatus from '../../components/BackendStatus';
import { useBackendData } from '../../hooks/useBackendData';
import LatestManualDetection from '../../components/LatestManualDetection';
import { getFreeRangeResults, withDetection } from '../../services/detectionService';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import FarmHero from '../../components/FarmHero';
import DevicePhoto from '../../components/DevicePhoto';
import { ConnectionBadge, MonitoringBadge } from '../../components/StatusBadge';
import { COLORS } from '../../constants/theme';
import { deleteDevice, getDevices } from '../../services/deviceStorage';
import type { Device, MonitoringStatus } from '../../types/device';
import { formatRatio } from '../../utils/ratio';
import { formatDeviceUpdate } from '../../utils/time';

type Filter = 'all' | MonitoringStatus | 'offline';
const filters:Filter[]=['all','normal','warning','offline'];
export default function FreeRangeScreen() {
  const {cwFilter,cwNavId}=useLocalSearchParams<{cwFilter?:string;cwNavId?:string}>();
  const handledNav=useRef('');
  const state=useBackendData(getDevices);
  const devices=state.data??[];
  const reload=state.retry;
  const [filter,setFilter]=useState<Filter>('all');
  const [selected,setSelected]=useState('');
  const [deviceOpen,setDeviceOpen]=useState(false);

  // The page displays one camera at a time; no redundant sort control.
  useEffect(()=>{
    if(!cwNavId||handledNav.current===cwNavId)return;
    handledNav.current=cwNavId;
    setFilter(filters.includes(cwFilter as Filter)?cwFilter as Filter:'all');
    setSelected('');
  },[cwFilter,cwNavId]);
  const all=useMemo(()=>devices.filter(d=>d.farming_type==='free_range'),[devices]);
  const list=useMemo(()=>all.filter(d=>filter==='all'||(filter==='offline'?d.device_status==='offline':d.device_status==='online'&&d.monitoring_status===filter)),[all,filter]);
  const selectedDevice=list.find(d=>d.device_id===selected)??list[0];
  const results=useBackendData(getFreeRangeResults,selectedDevice?.device_id??'');
  const camera=selectedDevice?withDetection(selectedDevice,results.data?.formal??null):undefined;
  const remove=(_d:Device)=>Alert.alert('Read-only monitoring','Device deletion is not enabled in Mobile Stage 1.');
  return <AppScreen>
    <FarmHero title="Free-range Monitoring" subtitle="Latest snapshots from each monitoring source"/><BackendStatus {...state}/><BackendStatus {...results}/>
    <View style={styles.toolbar}>
      <Text style={styles.total}>{all.length} devices</Text>
      <View style={styles.toolbarButtons}>
        <Pressable onPress={()=>router.push('/settings/free-range')} style={styles.secondary} accessibilityRole="button">
          <Ionicons name="settings-outline" size={15} color={COLORS.primaryDark}/><Text style={styles.secondaryText}>Settings</Text>
        </Pressable>
        <Pressable onPress={()=>router.push({pathname:'/device/add',params:{farming_type:'free_range'}})} style={styles.add} accessibilityRole="button" accessibilityLabel="Add free-range device">
          <Ionicons name="add" size={21} color="#fff"/>
        </Pressable>
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterRow}>
      {filters.map(f=><Pressable key={f} onPress={()=>{setFilter(f);setSelected('');}} style={[styles.chip,filter===f&&styles.chipActive]} accessibilityRole="button">
        {f!=='all'&&<View style={[styles.dot,{backgroundColor:f==='normal'?COLORS.normal:f==='warning'?COLORS.danger:COLORS.offline}]}/>}
        <Text style={[styles.chipText,filter===f&&styles.chipTextActive]}>{f==='all'?'All':f[0].toUpperCase()+f.slice(1)}</Text>
      </Pressable>)}
    </ScrollView>
    {camera&&<>
      <Text style={styles.selectorLabel}>Monitoring Device</Text>
      <Pressable style={styles.deviceSelect} onPress={()=>setDeviceOpen(true)} accessibilityRole="button" accessibilityLabel="Choose free-range monitoring device">
        <View style={styles.deviceSelectIcon}><Ionicons name="leaf-outline" size={17} color={COLORS.primaryDark}/></View>
        <View style={{flex:1,minWidth:0}}><Text style={styles.deviceSelectName} numberOfLines={1}>{camera.device_name}</Text><Text style={styles.deviceSelectCode}>{camera.device_code}</Text></View>
        <Ionicons name="chevron-down" size={18} color={COLORS.textSecondary}/>
      </Pressable>
    </>}
    {camera?<>
      <View style={styles.cameraCard}>
        <View style={styles.cardHead}><View style={{flex:1}}><Text style={styles.cameraName}>{camera.device_name}</Text><Text style={styles.code}>{camera.device_code}</Text></View><ConnectionBadge status={camera.device_status}/></View>
        <DevicePhoto device={camera} height={185}/>
        <View style={styles.imageFooter}><Text style={styles.updated}>Updated {formatDeviceUpdate(camera.detected_at)}</Text><Pressable onPress={()=>router.push(`/device/${camera.device_id}`)}><Text style={styles.link}>View Details →</Text></Pressable></View>
        <View style={styles.cardActions}><Pressable style={styles.smallBtn} onPress={()=>router.push(`/device/edit/${camera.device_id}`)}><Ionicons name="create-outline" size={14} color={COLORS.primaryDark}/><Text style={styles.smallBtnText}>Edit</Text></Pressable>
          <Pressable style={styles.smallBtn} onPress={()=>remove(camera)}><Ionicons name="trash-outline" size={14} color={COLORS.danger}/><Text style={[styles.smallBtnText,{color:COLORS.danger}]}>Delete</Text></Pressable></View>
      </View>
      <SnapshotSummary device={camera}/>{!results.loading && !results.error && !results.data?.formal && <LatestManualDetection device={camera} detection={results.data?.manual??null}/>}
    </>:!state.loading&&!state.error&&<View style={styles.empty}><Text style={styles.emptyTitle}>No matching free-range devices</Text><Text style={styles.emptyText}>No accessible devices match this view. Your account may not have a farm yet.</Text></View>}
    <Modal visible={deviceOpen} transparent animationType="slide" onRequestClose={()=>setDeviceOpen(false)}>
      <Pressable style={styles.modalBack} onPress={()=>setDeviceOpen(false)}><Pressable style={styles.modal} onPress={event=>event.stopPropagation()}>
        <View style={styles.modalHandle}/><Text style={styles.modalTitle}>Choose monitoring device</Text><Text style={styles.modalSub}>Select the free-range source to view.</Text>
        {list.map(d=><Pressable key={d.device_id} onPress={()=>{setSelected(d.device_id);setDeviceOpen(false);}} style={[styles.option,d.device_id===camera?.device_id&&styles.optionActive]}>
          <Ionicons name="leaf-outline" size={20} color={COLORS.primaryDark}/><View style={{flex:1}}><Text style={styles.optionName}>{d.device_name}</Text><Text style={styles.optionCode}>{d.device_code}</Text></View>
          <ConnectionBadge status={d.device_status}/>{d.device_id===camera?.device_id&&<Ionicons name="checkmark-circle" color={COLORS.primary} size={19}/>}
        </Pressable>)}
      </Pressable></Pressable>
    </Modal>
  </AppScreen>;
}
function SnapshotSummary({device}:{device:Device}) {
  const valid=!!device.latest_detection_id;
  return <View style={styles.summary}>
    <Text style={styles.summaryTitle}>Latest Snapshot Summary</Text><Text style={styles.summarySub}>{device.device_status!=='online'&&valid?'Last Recorded Result · ':''}Formal Result Snapshot, not the overall moving flock.</Text>
    {valid?<>
      <View style={styles.countRow}>{[['Normal',device.normal_count],['Low',device.low_count],['Total Detected',device.total_count]].map(([label,value])=><View key={String(label)} style={styles.count}><Text style={styles.countLabel}>{label}</Text><Text style={[styles.countValue,{color:label==='Low'?COLORS.danger:label==='Normal'?COLORS.normal:COLORS.text}]}>{value}</Text></View>)}</View>
      <View style={styles.ratioRow}><Ratio label="Normal Ratio" value={device.normal_ratio}/><Ratio label="Current Snapshot Low Ratio" value={device.low_ratio} low/></View>
      <View style={styles.statusLine}><Text style={styles.label}>Monitoring Status</Text><MonitoringBadge status={device.monitoring_status!}/></View>
      <View style={styles.note}><Ionicons name="information-circle-outline" size={16} color={COLORS.primaryDark}/><Text style={styles.noteText}>Warning uses Low Count across consecutive formal snapshots, not this ratio alone.</Text></View>
      {device.recent_chicken&&<View style={styles.recent}><Text style={styles.label}>Most Recent Chicken</Text><Text style={[styles.recentValue,{color:device.recent_chicken.classification==='low'?COLORS.danger:COLORS.normal}]}>{device.recent_chicken.classification==='low'?'Low':'Normal'}</Text><Text style={styles.confidence}>Confidence {device.recent_chicken.confidence}%</Text></View>}
    </>:<View style={styles.empty}><Text style={styles.emptyTitle}>No formal Result Snapshot</Text><Text style={styles.emptyText}>Manual detections are shown separately and never replace a formal snapshot.</Text></View>}
  </View>;
}
function Ratio({label,value,low=false}:{label:string;value:number|null;low?:boolean}) {
  return <View style={styles.ratioBox}><Text style={styles.label}>{label}</Text><Text style={[styles.ratioValue,{color:low?COLORS.danger:COLORS.primaryDark}]}>{formatRatio(value)}</Text>
    <View style={styles.track}><View style={[styles.fill,{width:`${Math.round((value??0)*100)}%`,backgroundColor:low?COLORS.danger:COLORS.primary}]}/></View>
  </View>;
}
const styles=StyleSheet.create({
  toolbar:{marginTop:5,marginBottom:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},total:{fontSize:11,color:COLORS.textSecondary},
  toolbarButtons:{flexDirection:'row',alignItems:'center',gap:9},secondary:{flexDirection:'row',gap:6,alignItems:'center',paddingHorizontal:12,height:38,borderRadius:11,borderWidth:1,borderColor:COLORS.border,backgroundColor:'#fff'},
  secondaryText:{fontSize:11,fontWeight:'800',color:COLORS.primaryDark},add:{width:38,height:38,borderRadius:11,backgroundColor:COLORS.primary,alignItems:'center',justifyContent:'center'},
  filters:{marginBottom:12},filterRow:{gap:7,paddingRight:5},chip:{flexDirection:'row',gap:5,alignItems:'center',paddingHorizontal:12,paddingVertical:9,borderRadius:999,borderWidth:1,borderColor:COLORS.border,backgroundColor:'#fff'},
  chipActive:{backgroundColor:COLORS.primarySoft,borderColor:'#E6C36B'},dot:{width:7,height:7,borderRadius:4},chipText:{fontSize:11,fontWeight:'700',color:COLORS.textSecondary},chipTextActive:{color:COLORS.primaryDark},
  selectorLabel:{fontSize:10,fontWeight:'700',color:COLORS.textSecondary,marginBottom:7},deviceSelect:{flexDirection:'row',alignItems:'center',gap:10,padding:8,borderRadius:13,borderWidth:1,borderColor:'#BFDCCB',backgroundColor:'#fff',marginBottom:13},
  deviceSelectIcon:{width:36,height:36,borderRadius:11,backgroundColor:COLORS.primarySoft,alignItems:'center',justifyContent:'center'},deviceSelectName:{fontSize:12,fontWeight:'800',color:COLORS.text},deviceSelectCode:{fontSize:10,color:COLORS.textSecondary,marginTop:3},
  cameraCard:{padding:13,borderWidth:1,borderColor:COLORS.border,borderRadius:18,backgroundColor:'#fff',marginBottom:14},cardHead:{flexDirection:'row',gap:9,alignItems:'center',justifyContent:'space-between',marginBottom:10},
  cameraName:{fontSize:16,fontWeight:'800',color:COLORS.text},code:{fontSize:10,color:COLORS.textSecondary,marginTop:3},imageFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:10},
  updated:{fontSize:10,color:COLORS.textLight},link:{fontSize:10,fontWeight:'800',color:COLORS.primaryDark},cardActions:{flexDirection:'row',gap:9,marginTop:12},
  smallBtn:{flexDirection:'row',gap:5,alignItems:'center',backgroundColor:COLORS.background,borderRadius:9,paddingHorizontal:10,paddingVertical:8},smallBtnText:{fontSize:10.5,fontWeight:'800',color:COLORS.primaryDark},
  summary:{padding:14,borderWidth:1,borderColor:COLORS.border,borderRadius:18,backgroundColor:'#fff',marginBottom:16},summaryTitle:{fontSize:16,fontWeight:'800',color:COLORS.text},summarySub:{fontSize:10,color:COLORS.textSecondary,marginTop:4},
  countRow:{flexDirection:'row',paddingVertical:12,marginTop:9,borderTopWidth:1,borderBottomWidth:1,borderColor:COLORS.border},count:{flex:1,alignItems:'center'},countLabel:{fontSize:10,color:COLORS.textSecondary},countValue:{fontSize:20,fontWeight:'900',marginTop:4},
  ratioRow:{flexDirection:'row',gap:10,marginTop:12},ratioBox:{flex:1,padding:11,borderRadius:13,backgroundColor:COLORS.surfaceSoft,borderWidth:1,borderColor:COLORS.border},label:{fontSize:10,fontWeight:'700',color:COLORS.textSecondary},
  ratioValue:{fontSize:21,fontWeight:'900',marginTop:4},track:{height:5,backgroundColor:'#EDF2EF',borderRadius:999,overflow:'hidden',marginTop:7},fill:{height:'100%',borderRadius:999},
  statusLine:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:13},note:{flexDirection:'row',gap:7,backgroundColor:COLORS.primarySoft,padding:10,borderRadius:12,marginTop:13},noteText:{fontSize:10,lineHeight:14,color:COLORS.primaryDark,flex:1},
  recent:{borderTopWidth:1,borderColor:COLORS.border,marginTop:12,paddingTop:12},recentValue:{fontSize:15,fontWeight:'800',marginTop:4},confidence:{fontSize:10,color:COLORS.textSecondary,marginTop:2},
  empty:{padding:22,alignItems:'center'},emptyTitle:{fontSize:14,fontWeight:'800',color:COLORS.text},emptyText:{fontSize:11,color:COLORS.textSecondary,marginTop:4,textAlign:'center'},
  modalBack:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(10,25,15,.36)'},modal:{backgroundColor:'#fff',padding:16,paddingBottom:28,borderTopLeftRadius:22,borderTopRightRadius:22},
  modalHandle:{width:38,height:4,borderRadius:2,backgroundColor:'#D8E1DC',alignSelf:'center',marginBottom:12},modalTitle:{fontSize:17,fontWeight:'900',color:COLORS.text},modalSub:{fontSize:10,color:COLORS.textSecondary,marginTop:3,marginBottom:12},
  option:{flexDirection:'row',alignItems:'center',gap:9,borderWidth:1,borderColor:COLORS.border,borderRadius:13,padding:11,marginBottom:8},optionActive:{backgroundColor:COLORS.primarySoft,borderColor:'#9FD3B4'},
  optionName:{fontSize:11.5,fontWeight:'800',color:COLORS.text},optionCode:{fontSize:10,color:COLORS.textSecondary,marginTop:2},
});
