import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import AppScreen from '../../components/AppScreen';
import BackendStatus from '../../components/BackendStatus';
import { InfoNote, SaveButton, SettingsBack, SettingsCard, SettingsHeader, ToggleRow } from '../../components/SettingsUI';
import { COLORS } from '../../constants/theme';
import { useBackendData } from '../../hooks/useBackendData';
import { userMessage } from '../../lib/userMessages';
import { localBackendWrites } from '../../services/apiClient';
import { getAlertNotificationSettings, saveAlertNotificationSettings } from '../../services/settingsService';

/** Same behaviour as Web Alert Settings: one switch that only controls the header alert icon. */
export default function AlertSettings() {
  const state = useBackendData(getAlertNotificationSettings);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const canWrite = localBackendWrites();
  useEffect(() => { if (state.data) setEnabled(state.data.in_app_enabled); }, [state.data]);

  if (enabled === null) {
    return <AppScreen><SettingsBack/><SettingsHeader title="Alert Settings" subtitle="Choose whether active system alerts are shown in the app header."/><BackendStatus {...state}/></AppScreen>;
  }

  const save = async () => {
    if (saving || !canWrite) return;
    setSaving(true);
    try {
      const saved = await saveAlertNotificationSettings({ in_app_enabled: enabled });
      setEnabled(saved.in_app_enabled);
      Alert.alert('Saved', 'Alert settings have been saved.');
    } catch (error) {
      Alert.alert('Save failed', userMessage(error, 'Settings were not saved. Please try again.'));
    } finally { setSaving(false); }
  };

  return <AppScreen>
    <SettingsBack/>
    <SettingsHeader title="Alert Settings" subtitle="Choose whether active system alerts are shown in the app header."/>
    <SettingsCard title="In-app Alerts" icon="notifications-outline"
      subtitle="Alerts are always created and resolved automatically. This switch only controls whether they are shown to you in the header.">
      <ToggleRow title="Show alerts in the app" subtitle="Low production, device offline, detection failed and stale data alerts."
        value={enabled} disabled={saving || !canWrite} onValueChange={setEnabled}/>
      <InfoNote>When off, the alert bell and its count in the header are hidden. Monitoring rules, Warning status and the Alerts tab are not affected.</InfoNote>
      <InfoNote>Cage uses Low-production Ratio and Free-range uses Low Count to decide Warning status. Active and Resolved are managed automatically by the Backend.</InfoNote>
    </SettingsCard>
    {!canWrite && <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 10 }}>Changing settings requires the local Backend.</Text>}
    {canWrite && <SaveButton onPress={save} saving={saving}/>}
  </AppScreen>;
}
