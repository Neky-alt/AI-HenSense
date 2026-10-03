import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AppScreen from '../../../components/AppScreen';
import BackendStatus from '../../../components/BackendStatus';
import { COLORS } from '../../../constants/theme';
import { useBackendData } from '../../../hooks/useBackendData';
import { getDeviceById } from '../../../services/detectionService';
import { DEVICE_NAME_MAX, deviceError, deviceManagementEnabled, renameDevice, validateDeviceName } from '../../../services/deviceService';

/** Only the name can change; Device ID and Farming Type are fixed at creation. */
export default function EditDevice() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useBackendData(getDeviceById, String(id));
  const device = state.data;
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const loaded = useRef(false);
  useEffect(() => { if (device && !loaded.current) { loaded.current = true; setName(device.device_name); } }, [device]);

  if (!deviceManagementEnabled()) {
    return <AppScreen><Back/><Text style={styles.h1}>Edit Device</Text><Text style={styles.sub}>Editing devices requires the local HenSense Backend.</Text></AppScreen>;
  }
  if (!device) return <AppScreen><Back/><BackendStatus {...state}/></AppScreen>;

  const unchanged = name.trim() === device.device_name;
  const save = async () => {
    if (pending || unchanged) return;
    const invalid = validateDeviceName(name);
    if (invalid) { setError(invalid.message); return; }
    setPending(true); setError('');
    try {
      await renameDevice(device.device_id, name);
      router.back();
      Alert.alert('Device updated', 'The device name has been saved.');
    } catch (e) {
      setError(deviceError(e, 'Unable to save the device name. Please try again.').message);
    } finally { setPending(false); }
  };

  return <AppScreen>
    <Back/>
    <Text style={styles.h1}>Edit Device</Text>
    <Text style={styles.sub}>Only the device name can be changed.</Text>
    <View style={styles.card}>
      <Text style={styles.label}>Device Name</Text>
      <TextInput value={name} onChangeText={v => { setName(v); setError(''); }} maxLength={DEVICE_NAME_MAX} editable={!pending}
        accessibilityLabel="Device Name" returnKeyType="done" onSubmitEditing={save} style={[styles.input, !!error && styles.inputError]}/>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <ReadOnly label="Device ID" value={device.device_code}/>
      <ReadOnly label="Farming Type" value={device.farming_type === 'caged' ? 'Caged' : 'Free-range'}/>
      <View style={styles.actions}>
        <Pressable disabled={pending} style={styles.cancel} onPress={() => router.back()}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        <Pressable disabled={pending || unchanged} accessibilityRole="button" style={[styles.save, (pending || unchanged) && { opacity: .5 }]} onPress={save}>
          {pending ? <ActivityIndicator color="#fff"/> : <Text style={styles.saveText}>Save Changes</Text>}
        </Pressable>
      </View>
    </View>
  </AppScreen>;
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <View><Text style={styles.label}>{label}</Text><View style={styles.readonly}><Text style={styles.readonlyText}>{value}</Text></View></View>;
}
function Back() {
  return <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={18} color={COLORS.textSecondary}/><Text style={styles.backText}>Back</Text></Pressable>;
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 14, alignSelf: 'flex-start' },
  backText: { fontSize: 10.5, fontWeight: '700', color: COLORS.textSecondary },
  h1: { fontSize: 21, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 5, marginBottom: 14 },
  card: { padding: 16, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  label: { fontSize: 10.5, fontWeight: '800', color: COLORS.text, marginBottom: 6, marginTop: 12 },
  input: { height: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, paddingHorizontal: 12, fontSize: 12, color: COLORS.text, backgroundColor: COLORS.surfaceSoft },
  inputError: { borderColor: COLORS.danger },
  error: { fontSize: 10, color: COLORS.danger, marginTop: 5 },
  readonly: { height: 44, borderRadius: 11, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: COLORS.offlineSoft },
  readonlyText: { fontSize: 12, color: COLORS.offline },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  cancel: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border },
  cancelText: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary },
  save: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, backgroundColor: COLORS.primary, minWidth: 112, alignItems: 'center' },
  saveText: { fontSize: 10.5, fontWeight: '800', color: '#fff' },
});
