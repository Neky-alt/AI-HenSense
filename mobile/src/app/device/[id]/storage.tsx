import ReadOnlyNotice from '../../../components/ReadOnlyNotice';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AppScreen from '../../../components/AppScreen';
import { InfoNote, OptionRow, SaveButton, SettingsBack, SettingsCard, SettingsHeader, TextField, ToggleRow } from '../../../components/SettingsUI';
import { COLORS } from '../../../constants/theme';
import { getDeviceById } from '../../../services/deviceStorage';
import { getDeviceStorageSettings, getDeviceStorageStatus, saveDeviceStorageSettings } from '../../../services/settingsService';
import type { Device } from '../../../types/device';
import type { DeviceStorageSettings, DeviceStorageStatus } from '../../../types/settings';

export default function StorageSettings() { return <ReadOnlyNotice/>; }
function LegacyStorageSettings() {
  const {id}=useLocalSearchParams<{id:string}>();
  const [device,setDevice]=useState<Device|null>(null);
  const [settings,setSettings]=useState<DeviceStorageSettings|null>(null);
  const [status,setStatus]=useState<DeviceStorageStatus|null>(null);
  const [imageDays,setImageDays]=useState('');
  const [videoDays,setVideoDays]=useState('');
  const [maxGb,setMaxGb]=useState('');
  useEffect(()=>{
    if(!id)return;
    let active=true;
    (async()=>{
      const d=await getDeviceById(id);
      if(!active||!d)return;
      const [s,state]=await Promise.all([getDeviceStorageSettings(d.device_id,d.farming_type==='free_range'),getDeviceStorageStatus(d.device_id)]);
      if(!active)return;
      setDevice(d);setSettings(s);setStatus(state);
      setImageDays(String(s.detection_image_retention_days));setVideoDays(String(s.video_retention_days));setMaxGb(String(s.max_media_storage_gb));
    })();
    return()=>{active=false;};
  },[id]);
  if(!device||!settings||!status)return <AppScreen><SettingsBack/><SettingsHeader title="Device Storage Settings" subtitle="Loading, please wait..."/></AppScreen>;
  const free=device.farming_type==='free_range';
  const set=(patch:Partial<DeviceStorageSettings>)=>setSettings(current=>current?{...current,...patch}:current);
  const save=async()=>{
    if(settings.store_detection_images&&(!/^\d+$/.test(imageDays)||Number(imageDays)<1)){
      Alert.alert('Invalid retention','Image retention must be at least one day.');return;
    }
    if(free&&settings.store_video_locally&&(!/^\d+$/.test(videoDays)||Number(videoDays)<1)){
      Alert.alert('Invalid retention','Video retention must be at least one day.');return;
    }
    if(!/^\d+(?:\.\d{1,2})?$/.test(maxGb)||Number(maxGb)<=0){Alert.alert('Invalid storage limit','Enter a positive maximum storage size in GB.');return;}
    await saveDeviceStorageSettings(device.device_id,{
      ...settings,detection_image_retention_days:settings.store_detection_images?Number(imageDays):settings.detection_image_retention_days,
      video_retention_days:free&&settings.store_video_locally?Number(videoDays):settings.video_retention_days,
      max_media_storage_gb:Number(maxGb),
    });
    Alert.alert('Saved','Storage settings have been saved locally for this device.');
  };
  return <AppScreen>
    <SettingsBack label={`Back to ${device.device_name}`}/>
    <SettingsHeader title="Device Storage Settings" subtitle={`Manage media on ${device.device_name} (${device.device_code}). ${free?'Pictures and optional video':'Detection images'} are stored on this device's SD card.`}/>
    <SettingsCard title="Local SD Card" subtitle="Prototype storage status; real capacity will be read from the Raspberry Pi when connected." icon="server-outline">
      <View style={styles.metrics}>
        {[['Capacity',status.capacity_gb],['Used',status.used_gb],['Available',status.available_gb]].map(([label,value])=><View key={label} style={styles.metric}>
          <Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value} GB</Text>
        </View>)}
      </View>
    </SettingsCard>
    <SettingsCard title="Detection Image Storage" subtitle="Save optional images associated with formal Detection results." icon="document-text-outline">
      <ToggleRow title="Store Detection Images" subtitle="Keep local image evidence for saved Detection records."
        value={settings.store_detection_images} onValueChange={store_detection_images=>set({store_detection_images})}/>
      {settings.store_detection_images&&<TextField label="Detection Image Retention" value={imageDays} onChangeText={v=>setImageDays(v.replace(/\D/g,''))} suffix="days"/>}
      <InfoNote>When image retention expires, only the media file is removed. Detection times, counts, ratios and status remain in History.</InfoNote>
    </SettingsCard>
    {free&&<SettingsCard title="Local Video" subtitle="Optionally record local free-range camera video. Full raw video is not uploaded to the cloud by default." icon="videocam-outline">
      <ToggleRow title="Store Video Locally" value={settings.store_video_locally} onValueChange={store_video_locally=>set({store_video_locally})}/>
      {settings.store_video_locally&&<TextField label="Video Retention" value={videoDays} onChangeText={v=>setVideoDays(v.replace(/\D/g,''))} suffix="days"/>}
    </SettingsCard>}
    <SettingsCard title="Storage Policy" subtitle={free?'The media limit is shared by Detection Images and Local Video.':'This limit applies to Cage detection images only; Cage does not require continuous video.'} icon="settings-outline">
      <TextField label={free?'Maximum Media Storage':'Maximum Image Storage'} value={maxGb} onChangeText={v=>setMaxGb(v.replace(/[^\d.]/g,''))} suffix="GB"/>
      <Text style={styles.label}>When Storage Limit Is Reached</Text>
      <OptionRow label={free?'Delete oldest media automatically':'Delete oldest images automatically'} selected={settings.storage_limit_action==='delete_oldest'} onPress={()=>set({storage_limit_action:'delete_oldest'})}/>
      <OptionRow label={free?'Stop recording new media':'Stop saving new images'} selected={settings.storage_limit_action==='stop_recording'} onPress={()=>set({storage_limit_action:'stop_recording'})}/>
      <InfoNote>Automatic cleanup only removes the configured media files. Detection History remains unless a user explicitly deletes a record.</InfoNote>
    </SettingsCard>
    <SaveButton onPress={save}/>
  </AppScreen>;
}
const styles=StyleSheet.create({
  metrics:{flexDirection:'row',gap:8},metric:{flex:1,minWidth:0,padding:10,borderRadius:11,backgroundColor:COLORS.background},
  metricLabel:{fontSize:9.5,color:COLORS.textSecondary},metricValue:{fontSize:14,fontWeight:'900',color:COLORS.text,marginTop:5},
  label:{fontSize:10.5,fontWeight:'800',color:COLORS.text,marginTop:16,marginBottom:9},
});
