import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';

export function SettingsBack({label='Back'}:{label?:string}) {
  return <Pressable onPress={()=>router.back()} style={styles.back}><Ionicons name="arrow-back" size={18} color={COLORS.textSecondary}/><Text style={styles.backText}>{label}</Text></Pressable>;
}
export function SettingsHeader({title,subtitle}:{title:string;subtitle:string}) {
  return <View style={{marginBottom:14}}><Text style={styles.h1}>{title}</Text><Text style={styles.sub}>{subtitle}</Text></View>;
}
export function SettingsCard({title,subtitle,children,icon}:{title:string;subtitle?:string;children:ReactNode;icon?:any}) {
  return <View style={styles.card}>
    <View style={styles.cardHeading}>
      {icon&&<View style={styles.icon}><Ionicons name={icon} size={20} color={COLORS.primaryDark}/></View>}
      <View style={{flex:1}}><Text style={styles.cardTitle}>{title}</Text>{subtitle?<Text style={styles.cardSub}>{subtitle}</Text>:null}</View>
    </View>
    <View style={styles.cardBody}>{children}</View>
  </View>;
}
export function ToggleRow({title,subtitle,value,onValueChange,disabled=false}:{title:string;subtitle?:string;value:boolean;onValueChange:(v:boolean)=>void;disabled?:boolean}) {
  return <View style={styles.toggleRow}><View style={{flex:1,paddingRight:10}}><Text style={styles.label}>{title}</Text>{subtitle?<Text style={styles.help}>{subtitle}</Text>:null}</View>
    <Switch value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{false:'#DDE4DF',true:'#E6C36B'}} thumbColor={value?COLORS.primary:'#F4F5F4'}/>
  </View>;
}
export function TextField({label,value,onChangeText,suffix,placeholder,keyboardType='numeric',disabled=false}: {
  label:string;value:string;onChangeText:(v:string)=>void;suffix?:string;placeholder?:string;keyboardType?:'numeric'|'default';disabled?:boolean;
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={[styles.inputRow,disabled&&{opacity:.5}]}>
    <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.textLight}
      editable={!disabled} keyboardType={keyboardType} accessibilityLabel={label}/>{suffix?<Text style={styles.suffix}>{suffix}</Text>:null}
  </View></View>;
}
export function OptionRow({label,selected,onPress}:{label:string;selected:boolean;onPress:()=>void}) {
  return <Pressable onPress={onPress} style={[styles.option,selected&&styles.optionActive]} accessibilityRole="radio" accessibilityState={{checked:selected}}>
    <Text style={[styles.optionText,selected&&{color:COLORS.primaryDark,fontWeight:'800'}]}>{label}</Text>
    {selected&&<Ionicons name="checkmark-circle" size={18} color={COLORS.primary}/>}</Pressable>;
}
export function UnitField({label,value,onChangeText,unit,onUnitChange}: {
  label:string;value:string;onChangeText:(v:string)=>void;unit:'minutes'|'hours';onUnitChange:(v:'minutes'|'hours')=>void;
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>
    <View style={styles.unitRow}>
      <TextInput accessibilityLabel={label} style={styles.unitInput} value={value} onChangeText={onChangeText} keyboardType="decimal-pad" placeholder="Enter interval" placeholderTextColor={COLORS.textLight}/>
      {(['minutes','hours'] as const).map(next=><Pressable key={next} accessibilityRole="button" onPress={()=>onUnitChange(next)} style={[styles.unitButton,unit===next&&styles.unitSelected]}>
        <Text style={[styles.unitText,unit===next&&styles.unitTextSelected]}>{next==='minutes'?'Min':'Hours'}</Text></Pressable>)}
    </View>
  </View>;
}
export function InfoNote({children,tone='green'}:{children:ReactNode;tone?:'green'|'red'}) {
  return <View style={[styles.infoNote,tone==='red'&&styles.infoNoteRed]}><Ionicons name="information-circle-outline" size={17} color={tone==='red'?COLORS.danger:COLORS.primaryDark}/>
    <Text style={[styles.noteText,tone==='red'&&{color:'#9D393E'}]}>{children}</Text></View>;
}
export function SaveButton({onPress,label='Save Changes',saving=false}:{onPress:()=>void;label?:string;saving?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:saving,busy:saving}} disabled={saving} onPress={onPress} style={[styles.save,saving&&{opacity:.6}]}><Text style={styles.saveText}>{saving?'Saving…':label}</Text></Pressable>;
}
const styles=StyleSheet.create({
  back:{flexDirection:'row',alignItems:'center',gap:5,paddingVertical:14,alignSelf:'flex-start'},backText:{fontSize:11,fontWeight:'700',color:COLORS.textSecondary},
  h1:{fontSize:21,fontWeight:'900',color:COLORS.text,letterSpacing:-.6},sub:{fontSize:10.5,lineHeight:15,color:COLORS.textSecondary,marginTop:5},
  card:{padding:15,borderWidth:1,borderColor:COLORS.border,borderRadius:18,backgroundColor:COLORS.surface,marginBottom:12},
  cardHeading:{flexDirection:'row',alignItems:'center',gap:9},icon:{width:36,height:36,alignItems:'center',justifyContent:'center',backgroundColor:COLORS.primarySoft,borderRadius:12},
  cardBody:{marginTop:14},cardTitle:{fontSize:15,fontWeight:'800',color:COLORS.text},cardSub:{fontSize:10,lineHeight:15,color:COLORS.textSecondary,marginTop:3},
  toggleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:9},label:{fontSize:10.5,fontWeight:'800',color:COLORS.text},
  help:{fontSize:9.6,lineHeight:14,color:COLORS.textSecondary,marginTop:3},field:{marginTop:13},
  inputRow:{flexDirection:'row',alignItems:'center',marginTop:7,borderWidth:1,borderColor:COLORS.border,borderRadius:11,backgroundColor:COLORS.surfaceSoft,overflow:'hidden'},
  input:{flex:1,minWidth:0,height:44,paddingHorizontal:11,fontSize:11.5,color:COLORS.text},suffix:{fontSize:10.5,color:COLORS.textSecondary,paddingHorizontal:10},
  option:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:11,borderWidth:1,borderColor:COLORS.border,borderRadius:11,marginBottom:7,backgroundColor:COLORS.surfaceSoft},
  optionActive:{borderColor:'#E6C36B',backgroundColor:COLORS.primarySoft},optionText:{fontSize:10.5,color:COLORS.text},
  unitRow:{marginTop:7,flexDirection:'row',gap:6,alignItems:'center'},unitInput:{flex:1,minWidth:0,borderWidth:1,borderColor:COLORS.border,borderRadius:11,paddingHorizontal:12,height:44,fontSize:12,color:COLORS.text},
  unitButton:{height:42,minWidth:41,paddingHorizontal:9,alignItems:'center',justifyContent:'center',borderRadius:10,borderWidth:1,borderColor:COLORS.border},
  unitSelected:{backgroundColor:COLORS.primarySoft,borderColor:'#E8CB85'},unitText:{fontSize:10,fontWeight:'700',color:COLORS.textSecondary},unitTextSelected:{color:COLORS.primaryDark},
  infoNote:{flexDirection:'row',gap:8,alignItems:'flex-start',padding:11,marginTop:12,backgroundColor:COLORS.primarySoft,borderRadius:12},
  infoNoteRed:{backgroundColor:COLORS.dangerSoft},noteText:{flex:1,color:COLORS.primaryDark,fontSize:10,lineHeight:15},
  save:{alignSelf:'flex-end',paddingHorizontal:18,paddingVertical:12,borderRadius:12,backgroundColor:COLORS.primary,marginTop:4,marginBottom:18},saveText:{fontSize:11,fontWeight:'800',color:COLORS.onPrimary},
});
export const settingsStyles=styles;
