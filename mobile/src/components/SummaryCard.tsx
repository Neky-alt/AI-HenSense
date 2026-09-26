import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';

type Tone='neutral'|'normal'|'warning'|'offline'|'highlight';
type Size='half'|'third';
const toneMap={neutral:['#EEF4FF',COLORS.highlight],normal:['#F2FBF5',COLORS.normal],warning:['#FFF4F4',COLORS.danger],offline:['#F5F7F8',COLORS.offline],highlight:['#F4F0FF','#6657D9']} as const;

export default function SummaryCard({title,value,caption,tone='neutral',onPress,icon='stats-chart-outline',size='half'}:{title:string;value:string|number;caption?:string;tone?:Tone;onPress?:()=>void;icon?:any;size?:Size}){
  const [bg,color]=toneMap[tone];
  const body=<><View style={[styles.icon,{backgroundColor:bg}]}><Ionicons name={icon} size={16} color={color}/></View><Text style={styles.title} numberOfLines={2}>{title}</Text><Text style={[styles.value,{color:tone==='warning'?COLORS.danger:tone==='normal'?COLORS.normal:COLORS.text}]}>{value}</Text>{caption?<Text style={styles.caption} numberOfLines={2}>{caption}</Text>:null}</>;
  const cardStyle=[styles.card,{backgroundColor:bg},size==='third'?styles.third:styles.half];
  return onPress?<Pressable onPress={onPress} style={({pressed})=>[...cardStyle,pressed&&{opacity:.75}]}>{body}</Pressable>:<View style={cardStyle}>{body}</View>;
}

const styles=StyleSheet.create({
  card:{minHeight:100,padding:10,borderWidth:1,borderColor:COLORS.border,borderRadius:14,backgroundColor:COLORS.surface,marginBottom:8},
  half:{width:'48.8%'},
  third:{width:'31.7%'},
  icon:{width:31,height:31,borderRadius:16,alignItems:'center',justifyContent:'center',marginBottom:7},
  title:{fontSize:10,fontWeight:'700',color:COLORS.textSecondary,lineHeight:13},
  value:{fontSize:21,fontWeight:'800',marginTop:3,letterSpacing:-.4},
  caption:{fontSize:8.7,color:COLORS.textLight,marginTop:2,lineHeight:11.5}
});
