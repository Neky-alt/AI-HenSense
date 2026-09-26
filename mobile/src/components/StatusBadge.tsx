import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import type { DeviceStatus, MonitoringStatus } from '../types/device';

export function MonitoringBadge({status}:{status:MonitoringStatus}){const warning=status==='warning'; return <View style={[styles.badge,{backgroundColor:warning?COLORS.dangerSoft:COLORS.normalSoft}]}><View style={[styles.dot,{backgroundColor:warning?COLORS.danger:COLORS.normal}]}/><Text style={[styles.text,{color:warning?COLORS.danger:COLORS.normal}]}>{warning?'Warning':'Normal'}</Text></View>}
export function ConnectionBadge({status}:{status:DeviceStatus}){const color=status==='online'?COLORS.normal:status==='error'?COLORS.danger:COLORS.offline; const bg=status==='online'?COLORS.normalSoft:status==='error'?COLORS.dangerSoft:COLORS.offlineSoft; const label=status==='online'?'Online':status==='error'?'Error':'Offline'; return <View style={[styles.badge,{backgroundColor:bg}]}><View style={[styles.dot,{backgroundColor:color}]}/><Text style={[styles.text,{color}]}>{label}</Text></View>}
const styles=StyleSheet.create({badge:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',paddingHorizontal:9,paddingVertical:5,borderRadius:999},dot:{width:6,height:6,borderRadius:3,marginRight:5},text:{fontSize:10,fontWeight:'800'}});
