import ReadOnlyNotice from '../../components/ReadOnlyNotice';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { InfoNote, SaveButton, SettingsBack, SettingsCard, SettingsHeader, ToggleRow } from '../../components/SettingsUI';
import { getNotificationSettings, saveNotificationSettings } from '../../services/settingsService';
import type { NotificationSettings } from '../../types/settings';
import type { AlertType } from '../../types/alert';

const types:{key:AlertType;title:string;subtitle:string}[]=[
  {key:'low_production_warning',title:'Low Production',subtitle:'Notify when a Cage or Free-range monitoring rule enters Warning.'},
  {key:'device_offline',title:'Device Offline',subtitle:'Notify when a monitoring device loses its connection.'},
  {key:'detection_failed',title:'Detection Failed',subtitle:'Notify when an AI or capture task cannot complete.'},
  {key:'stale_data',title:'Stale Data',subtitle:'Notify when an online device stops producing expected Detection results.'},
];
export default function AlertSettings() { return <ReadOnlyNotice/>; }
function LegacyAlertSettings() {
  const [settings,setSettings]=useState<NotificationSettings|null>(null);
  useEffect(()=>{getNotificationSettings().then(setSettings);},[]);
  if(!settings)return <AppScreen><SettingsBack/><SettingsHeader title="Alert & Notification Settings" subtitle="Loading, please wait..."/></AppScreen>;
  const toggle=(key:AlertType,value:boolean)=>setSettings(current=>current?{
    ...current,alert_type_preferences:{...current.alert_type_preferences,[key]:value}
  }:current);
  const save=async()=>{
    await saveNotificationSettings(settings);
    Alert.alert('Saved','Notification preferences have been saved locally.');
  };
  return <AppScreen>
    <SettingsBack/>
    <SettingsHeader title="Alert & Notification Settings" subtitle="Choose which automatically generated system alerts should notify you."/>
    <SettingsCard title="Notification Preferences" icon="notifications-outline" subtitle="These switches control in-app notifications only. The Backend still creates and resolves system alerts.">
      <ToggleRow title="All Alert Notifications" subtitle="Temporarily mute or enable all user-facing in-app notifications."
        value={settings.in_app_enabled} onValueChange={v=>setSettings({...settings,in_app_enabled:v})}/>
      {types.map(({key,title,subtitle})=><ToggleRow key={key} title={title} subtitle={subtitle}
        value={settings.alert_type_preferences[key]}
        onValueChange={value=>toggle(key,value)}/>)}
      <InfoNote>Notifications are {settings.in_app_enabled?'enabled':'muted'}. Low Production, Device Offline, Detection Failed and Stale Data alerts are always generated and resolved by Backend conditions.</InfoNote>
      <InfoNote>Individual alert switches are prototype-only preferences saved in AsyncStorage. The shared Backend API contract must be extended before cloud sync. Email and push delivery are not enabled in this version.</InfoNote>
    </SettingsCard>
    <SaveButton onPress={save}/>
  </AppScreen>;
}
