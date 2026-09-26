import BackendStatus from './BackendStatus';
import { useBackendData } from '../hooks/useBackendData';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { getDetectionsByDeviceId } from '../services/detectionService';
import { formatRatio } from '../utils/ratio';
import type { FarmingType } from '../types/device';
import RatioTrendChart from './RatioTrendChart';
import { MonitoringBadge } from './StatusBadge';

function rowTime(iso:string) {
  return new Date(iso).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
}
export default function DetectionHistory({ deviceId, farmingType }: {deviceId:string; farmingType:FarmingType}) {
  // Use saved formal Detection records, rather than generating visually plausible fake trend data.
  const state = useBackendData(getDetectionsByDeviceId,deviceId);
  const detections = state.data ?? [];
  const recent = detections.slice(0,5);
  return <View style={styles.section}>
    <BackendStatus {...state}/><Text style={styles.title}>Historical Trend</Text>
    <Text style={styles.subtitle}>{farmingType==='caged'?'Normal and Low-production ratios from saved Cage detections.':'Normal and Low ratios from saved free-range snapshots.'}</Text>
    <RatioTrendChart detections={farmingType==='free_range'?detections.filter(d=>d.trigger_type==='free_range_snapshot'):detections} farmingType={farmingType}/>
    <View style={styles.recentHead}>
      <View style={{flex:1}}><Text style={styles.title}>Recent Detections</Text>
        <Text style={styles.subtitle}>Saved results, including Manual Detection.</Text></View>
      <Pressable onPress={()=>router.push(`/device/${deviceId}/history`)} accessibilityRole="button"><Text style={styles.link}>View all →</Text></Pressable>
    </View>
    {recent.length ? recent.map(d=><Pressable key={d.detection_id} onPress={()=>router.push(`/device/${deviceId}/detections/${d.detection_id}`)} style={styles.row}>
      <View style={{flex:1}}><Text style={styles.rowTime}>{rowTime(d.detected_at)}</Text>
        <Text style={styles.rowCounts}>{d.trigger_type==='manual'?'Manual Detection · ':''}Normal {d.normal_count} / Low {d.low_count} / Total {d.total_count}</Text>
        <Text style={styles.rowRatio}>{formatRatio(d.normal_ratio)} normal · {formatRatio(d.low_ratio)} low</Text>
      </View>
      <MonitoringBadge status={d.monitoring_status}/>
    </Pressable>) : !state.loading && !state.error && <Text style={styles.empty}>No detection records yet.</Text>}
  </View>;
}
const styles=StyleSheet.create({
  section:{marginTop:20},title:{fontSize:16,fontWeight:'800',color:COLORS.text},
  subtitle:{fontSize:10,color:COLORS.textSecondary,marginTop:3,lineHeight:14},
  recentHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:22,marginBottom:10,gap:12},
  link:{fontSize:10,fontWeight:'800',color:COLORS.primaryDark},
  row:{flexDirection:'row',alignItems:'center',gap:8,padding:12,marginBottom:8,borderWidth:1,borderColor:COLORS.border,borderRadius:13,backgroundColor:COLORS.surface},
  rowTime:{fontSize:10.5,fontWeight:'700',color:COLORS.text},rowCounts:{fontSize:9.5,color:COLORS.textSecondary,marginTop:3},
  rowRatio:{fontSize:8.5,color:COLORS.textLight,marginTop:2},empty:{fontSize:10.5,color:COLORS.textSecondary,marginTop:6},
});
