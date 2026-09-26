import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';
const logo = require('../../assets/brand/hensense-logo.png');
export default function BrandHeader({showAlert=true}:{showAlert?:boolean}){return <View style={s.bar}><View style={s.brand}><Image source={logo} style={s.logo}/></View>{showAlert?<Pressable onPress={()=>router.push('/alerts')} style={s.bell}><Ionicons name="notifications-outline" color={COLORS.text} size={20}/></Pressable>:null}</View>}
const s=StyleSheet.create({bar:{height:62,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{flexDirection:'row',alignItems:'center',gap:7},logo:{height:75,width:80,resizeMode:'contain'},name:{fontSize:19,fontWeight:'900',color:COLORS.text},bell:{width:40,height:40,borderRadius:13,borderWidth:1,borderColor:COLORS.border,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'}});
