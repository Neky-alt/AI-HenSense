import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import AppScreen from './AppScreen';
import { COLORS } from '../constants/theme';
export default function ReadOnlyNotice() {
 return <AppScreen><Pressable onPress={()=>router.back()} style={{paddingVertical:16}}><Text style={{color:COLORS.primaryDark}}>← Back</Text></Pressable><Text style={{fontSize:18,fontWeight:'800'}}>Read-only monitoring</Text><Text style={{marginTop:12}}>Device, storage and monitoring configuration is not enabled in Mobile Stage 1. No changes have been sent to the Backend.</Text></AppScreen>;
}
