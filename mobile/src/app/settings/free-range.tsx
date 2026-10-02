import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { InfoNote, SaveButton, SettingsBack, SettingsCard, SettingsHeader, TextField, ToggleRow, UnitField } from '../../components/SettingsUI';
import { getMonitoringSettings, saveMonitoringSettings } from '../../services/settingsService';
import type { MonitoringSettings } from '../../types/settings';
type Unit='minutes'|'hours';
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
export default function FreeRangeSettings(){
  const [settings,setSettings]=useState<MonitoringSettings|null>(null);
  const [unit,setUnit]=useState<Unit>('minutes');
  const [interval,setInterval]=useState('');
  const [count,setCount]=useState('');
  const [start,setStart]=useState('');
  const [end,setEnd]=useState('');
  useEffect(()=>{getMonitoringSettings('free_range').then(s=>{
    setSettings(s);setInterval(String(s.result_snapshot_interval_minutes??5));
    setCount(String(s.free_range_warning_low_count_threshold??3));
    setStart(s.monitoring_start_time??'');setEnd(s.monitoring_end_time??'');
  });},[]);
  if(!settings)return <AppScreen><SettingsBack/><SettingsHeader title="Free-range Monitoring Settings" subtitle="Loading, please wait..."/></AppScreen>;
  const changeUnit=(next:Unit)=>{
    const value=Number(interval);
    if(interval.trim()&&Number.isFinite(value)){
      const minutes=value*(unit==='hours'?60:1);
      setInterval(next==='minutes'?String(Number(minutes.toFixed(2))):String(Number((minutes/60).toFixed(2))));
    }
    setUnit(next);
  };
  const save=async()=>{
    if(!HHMM.test(start)||!HHMM.test(end)){Alert.alert('Invalid time','Use a valid 24-hour HH:MM monitoring window.');return;}
    if(!/^\d+(?:\.\d{1,2})?$/.test(interval.trim())||Number(interval)<=0){Alert.alert('Invalid interval','Enter a positive Result Snapshot interval.');return;}
    const minutes=Math.round(Number(interval)*(unit==='hours'?60:1));
    if(!minutes){Alert.alert('Invalid interval','Choose an interval of at least one minute.');return;}
    if(!/^\d+$/.test(count.trim())){Alert.alert('Invalid threshold','Enter a non-negative whole number for the Low Count threshold.');return;}
    await saveMonitoringSettings({...settings,monitoring_start_time:start,monitoring_end_time:end,
      result_snapshot_interval_minutes:minutes,free_range_warning_low_count_threshold:Number(count)});
    Alert.alert(
      'Saved',
      'Free-range monitoring settings have been saved.'
);
  };
  return <AppScreen>
    <SettingsBack/>
    <SettingsHeader title="Free-range Monitoring Settings" subtitle="Configure continuous Pi-side AI monitoring and the interval between saved formal snapshots."/>
    <SettingsCard title="Continuous Monitoring" icon="leaf-outline" subtitle="The Pi repeatedly samples video frames and runs the existing image AI model.">
      <ToggleRow title="Monitoring Enabled" subtitle="Stops automatic monitoring when off, without deleting existing history or media."
        value={settings.monitoring_enabled} onValueChange={monitoring_enabled=>setSettings({...settings,monitoring_enabled})}/>
      <InfoNote>AI monitoring is continuous during the monitoring window. The frame sampling interval is a technical parameter and is not user-configurable.</InfoNote>
      <TextField label="Monitoring Window · Start" value={start} onChangeText={setStart} suffix="HH:MM" keyboardType="default"/>
      <TextField label="Monitoring Window · End" value={end} onChangeText={setEnd} suffix="HH:MM" keyboardType="default"/>
      <UnitField label="Result Snapshot Interval" value={interval} onChangeText={v=>setInterval(v.replace(/[^\d.]/g,''))} unit={unit} onUnitChange={changeUnit}/>
      <InfoNote>Only the formal Result Snapshots are saved at this interval. AI runs between snapshots while monitoring is enabled.</InfoNote>
    </SettingsCard>
    <SettingsCard title="Warning Rule" icon="warning-outline" subtitle="Warning uses Low Count from two consecutive formal Result Snapshots.">
      <TextField label="Low Count Warning Threshold" value={count} onChangeText={v=>setCount(v.replace(/[^\d]/g,''))} suffix="birds"/>
      <InfoNote tone="red">Current rule: Low Count ≥ {count || '—'} for two consecutive formal snapshots → Warning.</InfoNote>
      <InfoNote>A snapshot ratio describes one picture; it is not the overall Low-production Ratio for the moving flock.</InfoNote>
    </SettingsCard>
    <SaveButton onPress={save}/>
  </AppScreen>;
}
