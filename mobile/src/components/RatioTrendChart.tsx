import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import type { Detection } from '../types/detection';

const HEIGHT = 132;
const DOT = 7;
type TrendPoint = { id: string; time: string; normal: number | null; low: number | null };

function Stroke({ x1, y1, x2, y2, color }: {x1:number;y1:number;x2:number;y2:number;color:string}) {
  const dx = x2-x1, dy=y2-y1;
  const length = Math.hypot(dx,dy);
  const angle = Math.atan2(dy,dx)*180/Math.PI;
  return <View style={{ position:'absolute', left:(x1+x2-length)/2, top:(y1+y2)/2-1.25,
    width:length, height:2.5, backgroundColor:color, borderRadius:4, transform:[{rotate:`${angle}deg`}] }} />;
}

/** Draw two real time-series using native Views: works with the existing Expo dependencies. */
export default function RatioTrendChart({ detections, farmingType }: {
  detections: Detection[]; farmingType: 'caged'|'free_range';
}) {
  const [width, setWidth] = useState(0);
  const points:TrendPoint[] = [...detections]
    .filter(d => Number.isFinite(Date.parse(d.detected_at)) && d.total_count > 0 && d.normal_ratio !== null && d.low_ratio !== null)
    .sort((a,b) => Date.parse(a.detected_at)-Date.parse(b.detected_at))
    .slice(-7)
    .map(d => ({ id:d.detection_id, time:d.detected_at, normal:d.normal_ratio, low:d.low_ratio }));
  if (!points.length) return <View style={styles.empty}><Text style={styles.emptyText}>No valid historical detections yet.</Text></View>;

  const px = (index:number) => points.length === 1 ? width/2 : index * width / (points.length-1);
  const py = (ratio:number) => (1-Math.min(1,Math.max(0,ratio)))*HEIGHT;
  const lines = ([['normal',COLORS.normal],['low',COLORS.danger]] as const).flatMap(([key,color]) => {
    return points.slice(1).flatMap((p,i) => {
      const prev=points[i];const v1=prev[key],v2=p[key];
      return v1 !== null && v2 !== null ? [<Stroke key={`${key}-${i}`} x1={px(i)} y1={py(v1)} x2={px(i+1)} y2={py(v2)} color={color} />] : [];
    });
  });
  const labels = [0,Math.floor((points.length-1)/2),points.length-1].filter((x,i,arr)=>arr.indexOf(x)===i);
  const formatDate = (iso:string)=>new Date(iso).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});

  return <View style={styles.card}>
    <View style={styles.plotRow}>
      <View style={styles.axisLabels}>{[100,50,0].map(n=><Text key={n} style={styles.axisLabel}>{n}%</Text>)}</View>
      <View onLayout={e=>setWidth(e.nativeEvent.layout.width)} style={styles.plot}>
        {[0,HEIGHT/2,HEIGHT].map(y=><View key={y} style={[styles.grid,{top:y}]} />)}
        {width>0 && <>{lines}{points.flatMap((p,i)=> ([['normal',COLORS.normal],['low',COLORS.danger]] as const).map(([key,color]) => p[key] === null ? null : <View key={`${p.id}-${key}`} style={[styles.dot,{left:px(i)-DOT/2,top:py(p[key])-DOT/2,backgroundColor:color}]}/>))}</>}
      </View>
    </View>
    <View style={styles.dateRow}>{labels.map(i=><Text key={i} style={styles.date}>{formatDate(points[i].time)}</Text>)}</View>
    <View style={styles.legend}>
      <View style={styles.legendItem}><View style={[styles.legendDot,{backgroundColor:COLORS.normal}]}/><Text style={styles.legendText}>Normal Ratio</Text></View>
      <View style={styles.legendItem}><View style={[styles.legendDot,{backgroundColor:COLORS.danger}]}/><Text style={styles.legendText}>{farmingType==='caged'?'Low-production Ratio':'Snapshot Low Ratio'}</Text></View>
    </View>
    {farmingType==='free_range' && <Text style={styles.note}>Ratios describe each saved snapshot, not the overall moving flock.</Text>}
  </View>;
}
const styles=StyleSheet.create({
  card:{backgroundColor:COLORS.surface,borderWidth:1,borderColor:COLORS.border,borderRadius:16,padding:14,marginTop:10},
  plotRow:{flexDirection:'row',gap:8,alignItems:'flex-start'},
  axisLabels:{height:HEIGHT+4,justifyContent:'space-between',alignItems:'flex-end',width:30},
  axisLabel:{fontSize:9,color:COLORS.textSecondary},
  plot:{flex:1,minWidth:0,height:HEIGHT+1},grid:{height:1,position:'absolute',left:0,right:0,backgroundColor:COLORS.border},
  dot:{position:'absolute',width:DOT,height:DOT,borderRadius:DOT/2,borderWidth:1,borderColor:'#fff'},
  dateRow:{marginLeft:37,marginTop:9,flexDirection:'row',justifyContent:'space-between'},date:{fontSize:8.5,color:COLORS.textSecondary},
  legend:{marginTop:15,flexDirection:'row',flexWrap:'wrap',gap:13},legendItem:{flexDirection:'row',gap:6,alignItems:'center'},
  legendDot:{height:8,width:8,borderRadius:4},legendText:{fontSize:9.5,color:COLORS.textSecondary},
  note:{fontSize:9.5,color:COLORS.textSecondary,marginTop:10,lineHeight:14},
  empty:{padding:22,backgroundColor:COLORS.surface,borderWidth:1,borderColor:COLORS.border,borderRadius:14,marginTop:10},
  emptyText:{fontSize:11,color:COLORS.textSecondary},
});
