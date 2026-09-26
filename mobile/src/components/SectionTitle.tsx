import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
export default function SectionTitle({title,subtitle,right}:{title:string;subtitle?:string;right?:ReactNode}){return <View style={styles.row}><View style={{flex:1}}><Text style={styles.title}>{title}</Text>{subtitle?<Text style={styles.subtitle}>{subtitle}</Text>:null}</View>{right}</View>}
const styles=StyleSheet.create({row:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10,marginBottom:8},title:{fontSize:16,fontWeight:'800',color:COLORS.text,letterSpacing:-.25},subtitle:{fontSize:9.5,lineHeight:13,color:COLORS.textSecondary,marginTop:2}});
