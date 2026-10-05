import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import type { Alert, AlertType } from '../types/alert';
import type { Device } from '../types/device';
import { Pill } from './DesignKit';
import { formatElapsed } from '../utils/time';
const visuals:Record<AlertType,{label:string;icon:any;color:string;bg:string}>={
 low_production_warning:{label:'Low production warning',icon:'warning-outline',color:'#DD3642',bg:'#FFF0F1'},
 device_offline:{label:'Device offline',icon:'cloud-offline-outline',color:'#667481',bg:'#F0F3F6'},
 detection_failed:{label:'Detection failed',icon:'alert-circle-outline',color:'#B97B0D',bg:'#FFF3DD'},
 stale_data:{label:'Stale data',icon:'time-outline',color:'#CC5550',bg:'#FFF0F1'},
};
export default function AlertCard({alert,device,compact=false}:{alert:Alert;device?:Device;compact?:boolean}){
 const v=visuals[alert.alert_type];const active=alert.alert_status==='active';
 const time=new Date(alert.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
 return <Pressable disabled={!device} accessibilityRole={device?'button':undefined} onPress={()=>device&&router.push(`/device/${device.device_id}`)} style={({pressed})=>[styles.row,compact&&styles.compact,pressed&&{opacity:.72}]}>
   <View style={[styles.icon,compact&&styles.compactIcon,{backgroundColor:v.bg}]}><Ionicons name={v.icon} size={compact?19:25} color={v.color}/></View>
   <View style={styles.body}><Text style={[styles.title,compact&&styles.compactTitle]} numberOfLines={1}>{v.label}</Text><Text style={[styles.device,compact&&styles.compactDevice]} numberOfLines={1}>{device?.device_name??'Unknown device'}</Text>{!compact&&<Text style={styles.message} numberOfLines={2}>{alert.message}</Text>}{!compact&&<Text style={styles.time}>{time}</Text>}</View>
   <View style={styles.end}><Pill text={active?'Active':'Resolved'} tone={active?'red':'green'}/>{compact?<Text style={styles.shortTime}>{formatElapsed(alert.created_at)??time}</Text>:null}</View>
   {device?<Ionicons name="chevron-forward" size={16} color={COLORS.textLight}/>:null}
 </Pressable>
}
const styles=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:10,paddingVertical:13,marginBottom:9,borderWidth:1,borderColor:COLORS.border,borderRadius:17,backgroundColor:'#fff'},compact:{paddingHorizontal:3,paddingVertical:7,marginBottom:0,borderWidth:0,borderBottomWidth:1,borderRadius:0},compactIcon:{width:35,height:35,borderRadius:11},compactTitle:{fontSize:11},compactDevice:{fontSize:9.5,marginTop:2},icon:{width:48,height:48,borderRadius:15,alignItems:'center',justifyContent:'center'},body:{flex:1,minWidth:0},title:{fontSize:13,fontWeight:'900',color:COLORS.text},device:{fontSize:10.5,color:COLORS.textSecondary,marginTop:4},message:{fontSize:10.5,lineHeight:15,color:COLORS.textSecondary,marginTop:4},time:{fontSize:9.5,color:COLORS.textLight,marginTop:6},end:{alignItems:'flex-end',gap:6},shortTime:{fontSize:9,color:COLORS.textLight}});
