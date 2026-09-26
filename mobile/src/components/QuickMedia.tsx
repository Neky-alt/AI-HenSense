import { useState } from 'react';
import { Pressable,Text,View } from 'react-native';
import { Photo } from './DevicePhoto';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/apiClient';
import { quickMediaUrl } from '../services/quickDetectionCore';
import type { QuickDetection } from '../types/quickDetection';
import { COLORS } from '../constants/theme';
export default function QuickMedia({record,thumbnail=false}:{record:QuickDetection;thumbnail?:boolean}){
 const {session}=useAuth();const [original,setOriginal]=useState(!record.annotated_image_url);
 if(!session)return null;
 const url=record.image_url?quickMediaUrl(record.image_url,API_BASE_URL):null;
 const annotated=record.annotated_image_url?quickMediaUrl(record.annotated_image_url,API_BASE_URL):null;
 return <View>{!thumbnail&&annotated&&<View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}>{['Original','Annotated'].map(label=><Pressable key={label} accessibilityRole="button" accessibilityState={{selected:original===(label==='Original')}} onPress={()=>setOriginal(label==='Original')} style={{padding:12,borderWidth:1,borderColor:COLORS.border,borderRadius:10}}><Text style={{color:COLORS.primaryDark,fontWeight:'700'}}>{label}{original===(label==='Original')?' ✓':''}</Text></Pressable>)}</View>}
 <Photo key={`${record.quick_detection_id}:${original}:${session.access_token}`} original={url} annotated={original&&!thumbnail?null:annotated} headers={{Authorization:`Bearer ${session.access_token}`}} height={thumbnail?100:235} caption="Quick Detection image"/>
 </View>;
}
