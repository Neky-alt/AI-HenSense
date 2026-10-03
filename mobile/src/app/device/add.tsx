import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { COLORS } from '../../constants/theme';
import {
  createDevice, deviceError, deviceManagementEnabled, normalizeDeviceCode,
  validateDeviceCode, validateDeviceName, type DeviceField,
} from '../../services/deviceService';
import type { FarmingType } from '../../types/device';

const listFor = (type: FarmingType) => (type === 'caged' ? '/cage' : '/free-range');

export default function AddDevice() {
  const { farming_type } = useLocalSearchParams<{ farming_type?: string }>();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<FarmingType>(farming_type === 'free_range' ? 'free_range' : 'caged');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<DeviceField | 'form', string>>>({});
  const lock = useRef(false);

  if (!deviceManagementEnabled()) {
    return <AppScreen><Back/><Text style={styles.h1}>Add Device</Text>
      <Text style={styles.sub}>Adding devices requires the local HenSense Backend. This app is showing a cloud snapshot.</Text></AppScreen>;
  }

  const submit = async () => {
    if (lock.current) return;
    const invalid = validateDeviceCode(code) ?? validateDeviceName(name);
    if (invalid) { setErrors({ [invalid.field ?? 'form']: invalid.message }); return; }
    lock.current = true; setPending(true); setErrors({});
    try {
      const created = await createDevice({ device_code: code, device_name: name, farming_type: type });
      // The list screen reloads on focus, so the new (offline) device appears immediately.
      router.replace(listFor(type));
      Alert.alert('Device added', `${created.device_code ?? normalizeDeviceCode(code)} will show as Online after the Raspberry Pi connects.`);
    } catch (error) {
      const e = deviceError(error, 'Unable to add this device. Please try again.');
      setErrors({ [e.field ?? 'form']: e.message });
    } finally {
      lock.current = false; setPending(false);
    }
  };

  return <AppScreen>
    <Back/>
    <Text style={styles.h1}>Add Device</Text>
    <Text style={styles.sub}>Enter the Device ID printed on the Raspberry Pi.</Text>
    <View style={styles.card}>
      <Text style={styles.label}>Device ID</Text>
      <TextInput value={code} onChangeText={v => { setCode(v.toUpperCase()); setErrors(c => ({ ...c, device_code: undefined })); }}
        placeholder={type === 'caged' ? 'e.g. PI-005' : 'e.g. FR-004'} placeholderTextColor={COLORS.textLight}
        autoCapitalize="characters" autoCorrect={false} maxLength={32} editable={!pending}
        accessibilityLabel="Device ID" style={[styles.input, !!errors.device_code && styles.inputError]}/>
      {errors.device_code ? <Text style={styles.error}>{errors.device_code}</Text>
        : <Text style={styles.help}>Letters, numbers and hyphens. Cannot be changed later.</Text>}

      <Text style={styles.label}>Device Name</Text>
      <TextInput value={name} onChangeText={v => { setName(v); setErrors(c => ({ ...c, device_name: undefined })); }}
        placeholder={type === 'caged' ? 'e.g. Cage C-05' : 'e.g. Free-range Area 04'} placeholderTextColor={COLORS.textLight}
        maxLength={64} editable={!pending} accessibilityLabel="Device Name" returnKeyType="done" onSubmitEditing={submit}
        style={[styles.input, !!errors.device_name && styles.inputError]}/>
      {!!errors.device_name && <Text style={styles.error}>{errors.device_name}</Text>}

      <Text style={styles.label}>Farming Type</Text>
      <View style={styles.typeRow}>
        <TypeOption title="Caged" subtitle="Monitor chickens in cages." icon="grid-outline" active={type === 'caged'} disabled={pending} onPress={() => setType('caged')}/>
        <TypeOption title="Free-range" subtitle="Monitor a free-range area." icon="leaf-outline" active={type === 'free_range'} disabled={pending} onPress={() => setType('free_range')}/>
      </View>
      {errors.farming_type ? <Text style={styles.error}>{errors.farming_type}</Text>
        : <Text style={styles.help}>Cannot be changed later.</Text>}

      {!!errors.form && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 12 }]}>{errors.form}</Text>}
      <View style={styles.actions}>
        <Pressable disabled={pending} style={styles.cancel} onPress={() => router.back()}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        <Pressable disabled={pending} accessibilityRole="button" style={[styles.save, pending && { opacity: .6 }]} onPress={submit}>
          {pending ? <ActivityIndicator color="#fff"/> : <Text style={styles.saveText}>Add Device</Text>}
        </Pressable>
      </View>
    </View>
  </AppScreen>;
}

function Back() {
  return <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={18} color={COLORS.textSecondary}/><Text style={styles.backText}>Back</Text></Pressable>;
}

function TypeOption({ title, subtitle, active, disabled, onPress, icon }: { title: string; subtitle: string; active: boolean; disabled: boolean; onPress: () => void; icon: any }) {
  return <Pressable disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.typeCard, active && styles.typeActive]}>
    <Ionicons name={icon} size={20} color={active ? COLORS.primaryDark : COLORS.textSecondary}/>
    <Text style={[styles.typeTitle, active && { color: COLORS.primaryDark }]}>{title}</Text>
    <Text style={styles.typeSub}>{subtitle}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 14, alignSelf: 'flex-start' },
  backText: { fontSize: 10.5, fontWeight: '700', color: COLORS.textSecondary },
  h1: { fontSize: 21, fontWeight: '900', color: COLORS.text, letterSpacing: -.6 },
  sub: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 5, marginBottom: 14 },
  card: { padding: 16, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  label: { fontSize: 10.5, fontWeight: '800', color: COLORS.text, marginBottom: 6, marginTop: 12 },
  input: { height: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, paddingHorizontal: 12, fontSize: 12, color: COLORS.text, backgroundColor: COLORS.surfaceSoft },
  inputError: { borderColor: COLORS.danger },
  help: { fontSize: 9.5, color: COLORS.textSecondary, marginTop: 5 },
  error: { fontSize: 10, color: COLORS.danger, marginTop: 5 },
  typeRow: { flexDirection: 'row', gap: 9 },
  typeCard: { flex: 1, padding: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: COLORS.surfaceSoft },
  typeActive: { borderColor: '#E6C36B', backgroundColor: COLORS.primarySoft },
  typeTitle: { fontSize: 11.5, fontWeight: '800', color: COLORS.text, marginTop: 6 },
  typeSub: { fontSize: 9, lineHeight: 13, color: COLORS.textSecondary, marginTop: 3 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  cancel: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border },
  cancelText: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary },
  save: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, backgroundColor: COLORS.primary, minWidth: 104, alignItems: 'center' },
  saveText: { fontSize: 10.5, fontWeight: '800', color: '#fff' },
});
