import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageKey } from './accountScope';
import type { DeviceStorageSettings, DeviceStorageStatus, MonitoringSettings, NotificationSettings } from '../types/settings';

const CAGE_KEY='@country-watch/settings/cage-v2'; const FREE_KEY='@country-watch/settings/free-v2'; const NOTIFY_KEY='@country-watch/settings/notify-v2';
const cageDefault:MonitoringSettings={ farming_type:'caged',monitoring_enabled:true,monitoring_start_time:'10:00',monitoring_end_time:'14:00',detection_mode:'scheduled',detection_interval_minutes:30,scheduled_times:['12:00'],cage_warning_low_ratio_threshold:.6,result_snapshot_interval_minutes:null,free_range_warning_low_count_threshold:null };
const freeDefault:MonitoringSettings={ farming_type:'free_range',monitoring_enabled:true,monitoring_start_time:'08:00',monitoring_end_time:'18:00',detection_mode:null,detection_interval_minutes:null,scheduled_times:null,cage_warning_low_ratio_threshold:null,result_snapshot_interval_minutes:5,free_range_warning_low_count_threshold:3 };
const alertDefaults:NotificationSettings['alert_type_preferences']={low_production_warning:true,device_offline:true,detection_failed:true,stale_data:true};
const notifyDefault:NotificationSettings={in_app_enabled:true,email_enabled:false,push_enabled:false,alert_type_preferences:alertDefaults};
const storageDefault=(free:boolean):DeviceStorageSettings=>({store_detection_images:true,detection_image_retention_days:30,store_video_locally:free,video_retention_days:7,max_media_storage_gb:80,storage_limit_action:'delete_oldest'});
async function read<T>(key:string,fallback:T):Promise<T>{const raw=await AsyncStorage.getItem(await accountStorageKey(key));return raw?JSON.parse(raw) as T:fallback;}
async function write<T>(key:string,value:T){await AsyncStorage.setItem(await accountStorageKey(key),JSON.stringify(value));return value;}
export const getMonitoringSettings=(type:'caged'|'free_range')=>read(type==='caged'?CAGE_KEY:FREE_KEY,type==='caged'?cageDefault:freeDefault);
export const saveMonitoringSettings=(value:MonitoringSettings)=>write(value.farming_type==='caged'?CAGE_KEY:FREE_KEY,value);
export const getNotificationSettings=async():Promise<NotificationSettings>=>{
  const stored=await read<Partial<NotificationSettings>>(NOTIFY_KEY,notifyDefault);
  // Existing V4 settings have channel flags but no per-alert-type preferences.
  return {...notifyDefault,...stored,alert_type_preferences:{...alertDefaults,...stored.alert_type_preferences}};
};
export const saveNotificationSettings=(value:NotificationSettings)=>write(NOTIFY_KEY,value);
export const getDeviceStorageSettings=(deviceId:string,free:boolean)=>read(`@country-watch/storage/${deviceId}-v2`,storageDefault(free));
export const saveDeviceStorageSettings=(deviceId:string,value:DeviceStorageSettings)=>write(`@country-watch/storage/${deviceId}-v2`,value);
export const getDeviceStorageStatus=async(_deviceId:string):Promise<DeviceStorageStatus>=>({capacity_gb:128,used_gb:32,available_gb:96});
