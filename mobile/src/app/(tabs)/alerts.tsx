import BackendStatus from '../../components/BackendStatus';
import { useBackendData } from '../../hooks/useBackendData';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router,useFocusEffect } from 'expo-router';
import { useCallback,useMemo,useState } from 'react';
import { Pressable,StyleSheet,Text,View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import FarmHero from '../../components/FarmHero';
import AlertCard from '../../components/AlertCard';
import { Panel,Pill } from '../../components/DesignKit';
import { COLORS } from '../../constants/theme';
import { getAlerts } from '../../services/detectionService';
import { getDevices } from '../../services/deviceStorage';
import type { AlertStatus } from '../../types/alert';
import type { Device } from '../../types/device';
type Filter='all'|AlertStatus;
async function loadAlerts(id:string,signal:AbortSignal){const [devices,alerts]=await Promise.all([getDevices(id,signal),getAlerts(id,signal)]);return {devices,alerts};}
export default function AlertsScreen(){const [filter,setFilter]=useState<Filter>('all');const state=useBackendData(loadAlerts);const devices=state.data?.devices??[];const alerts=state.data?.alerts??[];const filtered=useMemo(()=>filter==='all'?alerts:alerts.filter(a=>a.alert_status===filter),[filter,alerts]);return <AppScreen><FarmHero title="Alerts" subtitle="Monitoring issues and automatic recovery status" alertCount={alerts.filter(a=>a.alert_status==='active').length}/>
<BackendStatus {...state}/><View style={s.filters}>{(['all','active','resolved'] as Filter[]).map(f=><Pressable key={f} style={[s.filter,filter===f&&s.active]} onPress={()=>setFilter(f)}><Text style={[s.filterText,filter===f&&s.activeText]}>{f[0].toUpperCase()+f.slice(1)}</Text></Pressable>)}<Pressable onPress={()=>router.push('/settings/alerts')} style={s.settings}><Ionicons name="settings-outline" size={18} color={COLORS.primaryDark}/></Pressable></View>
{filtered.map(a=><AlertCard key={a.alert_id} alert={a} device={devices.find(d=>d.device_id===a.device_id)}/>)}{!state.loading&&!state.error&&filtered.length===0?<Panel><Text style={s.empty}>No alerts in this category.</Text></Panel>:null}
<Panel style={{marginTop:8}}><View style={s.note}><View style={s.noteIcon}><Ionicons name="checkmark-circle-outline" size={25} color={COLORS.primaryDark}/></View><View style={{flex:1}}><Text style={s.noteTitle}>Alerts resolve automatically</Text><Text style={s.noteText}>When monitoring conditions recover, the system updates each alert. Notification settings only control delivery.</Text></View></View></Panel>
</AppScreen>}
const s=StyleSheet.create({filters:{flexDirection:'row',gap:7,marginBottom:15,alignItems:'center'},filter:{flex:1,paddingVertical:12,backgroundColor:'#fff',borderWidth:1,borderColor:COLORS.border,borderRadius:13,alignItems:'center'},active:{backgroundColor:COLORS.primarySoft,borderColor:'#C8EDD6'},filterText:{fontSize:12,fontWeight:'800',color:COLORS.textSecondary},activeText:{color:COLORS.primaryDark},settings:{padding:10,backgroundColor:'#fff',borderWidth:1,borderColor:COLORS.border,borderRadius:13},empty:{color:COLORS.textSecondary,padding:16,textAlign:'center'},note:{flexDirection:'row',gap:12,alignItems:'center'},noteIcon:{height:48,width:48,backgroundColor:COLORS.primarySoft,borderRadius:15,alignItems:'center',justifyContent:'center'},noteTitle:{fontSize:14,fontWeight:'900',color:COLORS.text},noteText:{fontSize:11,lineHeight:16,color:COLORS.textSecondary,marginTop:4}});
