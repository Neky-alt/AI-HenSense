import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, CONTENT_MAX_WIDTH } from '../constants/theme';

export default function AppScreen({children, scroll=true}:{children:ReactNode;scroll?:boolean}){
  const inner=<View style={styles.inner}>{children}</View>;
  return <SafeAreaView style={styles.safe} edges={['top']}>{scroll?<ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>{inner}</ScrollView>:<View style={styles.fill}>{inner}</View>}</SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:COLORS.background},scroll:{paddingBottom:28},fill:{flex:1},inner:{width:'100%',maxWidth:CONTENT_MAX_WIDTH,alignSelf:'center',paddingHorizontal:18}});
