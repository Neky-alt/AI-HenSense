import { userMessage } from '../../lib/userMessages';
import { useEffect,useRef,useState } from 'react';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator,Image,Linking,Pressable,Text,View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { Panel } from '../../components/DesignKit';
import { QuickHeader,quickStyles as s } from '../../components/QuickUI';
import { useAuth } from '../../contexts/AuthContext';
import { clearDraft,readDraft,saveDraft,uploadQuick } from '../../services/quickDetectionService';
import { validatePhoto } from '../../services/quickDetectionCore';
import type { QuickDraft,QuickMode,QuickSource } from '../../types/quickDetection';
import { COLORS } from '../../constants/theme';
export default function QuickDetectionPage(){
 const {user}=useAuth();return user?<QuickForm key={user.id} userId={user.id}/>:null;
}
function QuickForm({userId}:{userId:string}){
 const [draft,setDraft]=useState<QuickDraft|null>(null);const [mode,setMode]=useState<QuickMode>('caged');const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);const [picking,setPicking]=useState(false);const [progress,setProgress]=useState<number|null>(0);const [error,setError]=useState('');const [permissionDenied,setPermissionDenied]=useState(false);
 const lock=useRef(false);const active=useRef(true);const controller=useRef<AbortController|null>(null);
 useEffect(()=>{active.current=true;readDraft(userId).then(value=>{if(active.current&&value){setDraft(value);setMode(value.mode);}}).catch(()=>{if(active.current)setError('Could not restore the previous photo. Choose it again.');}).finally(()=>{if(active.current)setReady(true);});return()=>{active.current=false;controller.current?.abort();};},[userId]);
 const choose=async(source:QuickSource)=>{
  if(lock.current||!ready)return;lock.current=true;setPicking(true);setError('');setPermissionDenied(false);
  try{
   const permission=source==='camera'?await ImagePicker.requestCameraPermissionsAsync():await ImagePicker.requestMediaLibraryPermissionsAsync();
   if(!permission.granted){setPermissionDenied(true);throw new Error(`${source==='camera'?'Camera':'Photo library'} permission was denied. You can enable it in Settings.`);}
   const options:ImagePicker.ImagePickerOptions={mediaTypes:['images'],allowsEditing:false,quality:1,preferredAssetRepresentationMode:ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible};
   const selected=source==='camera'?await ImagePicker.launchCameraAsync(options):await ImagePicker.launchImageLibraryAsync(options);
   if(selected.canceled||!selected.assets.length)return;
   const asset=selected.assets[0];validatePhoto(asset);
   const next:QuickDraft={photo:{uri:asset.uri,mimeType:asset.mimeType,fileSize:asset.fileSize,fileName:asset.fileName},mode,source,requestId:randomUUID()};
   await saveDraft(userId,next);if(active.current)setDraft(next);
  }catch(e){if(active.current)setError(userMessage(e, 'Unable to select photo.'));}
  finally{lock.current=false;if(active.current)setPicking(false);}
 };
 const changeMode=async(value:QuickMode)=>{
  if(lock.current||!ready||mode===value)return;lock.current=true;
  try{if(draft){const next={...draft,mode:value,requestId:randomUUID()};await saveDraft(userId,next);setDraft(next);}setMode(value);}
  catch{setError('Unable to save mode. Please retry.');}finally{lock.current=false;}
 };
 const analyze=async()=>{
  if(lock.current||!draft)return;lock.current=true;setBusy(true);setProgress(0);setError('');controller.current=new AbortController();
  try{
   // Persist the key BEFORE sending: lost responses/restarts reuse the same request.
   await saveDraft(userId,draft);
   const record=await uploadQuick(draft,userId,value=>{if(active.current)setProgress(value);},controller.current.signal);
   if(record.status==='succeeded'){await clearDraft(userId);if(active.current)setDraft(null);}
   if(active.current)router.push(`/quick-detection/${record.quick_detection_id}`);
  }catch(e){if(active.current)setError(userMessage(e, 'Upload failed. Retry the same photo safely.'));}
  finally{lock.current=false;if(active.current)setBusy(false);}
 };
 return <AppScreen><QuickHeader disabled={busy||picking}/><Text style={s.title}>Quick Detection</Text><Text style={s.text}>One photo, saved privately to your account. No device required.</Text>
 <View style={s.row}>{(['caged','free_range'] as QuickMode[]).map(value=><Pressable key={value} disabled={busy||picking||!ready} accessibilityRole="button" accessibilityState={{selected:mode===value}} onPress={()=>void changeMode(value)} style={[s.button,{flex:1},mode===value&&s.active]}><Text style={s.buttonText}>{value==='caged'?'Caged':'Free-range'}</Text></Pressable>)}</View>
 {mode==='free_range'&&<Text style={s.text}>Single-frame result only. This model keeps at most one detected head per image; this is not a count of the whole flock.</Text>}
 <View style={s.row}><Pressable disabled={busy||picking||!ready} onPress={()=>void choose('camera')} style={[s.button,{flex:1}]}><Text style={s.buttonText}>Take Photo</Text></Pressable><Pressable disabled={busy||picking||!ready} onPress={()=>void choose('gallery')} style={[s.button,{flex:1}]}><Text style={s.buttonText}>Choose from Gallery</Text></Pressable></View>
 {draft&&<Panel><Image source={{uri:draft.photo.uri}} style={{height:240,width:'100%',borderRadius:12}} resizeMode="contain"/><Text style={s.text}>Use Take Photo or Choose from Gallery to replace this photo.</Text></Panel>}
 {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}{permissionDenied&&<Pressable style={s.button} onPress={()=>void Linking.openSettings()}><Text style={s.buttonText}>Open Settings</Text></Pressable>}
 {(busy||picking||!ready)&&<View style={s.row}><ActivityIndicator color={COLORS.primary}/><Text style={s.text}>{busy?(progress===100?'Analyzing with AI…':progress===null?'Uploading photo…':`Uploading photo… ${progress}%`):picking?'Selecting photo…':'Restoring photo…'}</Text></View>}
 <Pressable accessibilityRole="button" disabled={!draft||busy||picking||!ready} onPress={()=>void analyze()} style={[s.button,s.primary,{opacity:(!draft||busy||picking||!ready)?0.45:1}]}><Text style={s.buttonText}>{busy?'Please wait…':'Analyze Photo'}</Text></Pressable>
 <Text style={[s.text,{marginVertical:14}]}>JPEG/PNG · up to 10 MB and 24 megapixels. Results do not change farm monitoring, statistics or alerts.</Text>
 </AppScreen>;
}
