import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { deviceError, normalizeDeviceCode, removeDevice } from '../services/deviceService';
import type { Device } from '../types/device';

type Step = 'choose' | 'purge';

/**
 * Two ways to remove a device (DEVICE_MANAGEMENT_API §2.3/§2.4):
 * keep history (soft remove) or delete everything, which needs the Device ID typed again.
 */
export default function RemoveDeviceSheet({ device, visible, onClose, onRemoved }: {
  device: Device; visible: boolean; onClose: () => void; onRemoved: (purged: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('choose');
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState<'keep' | 'purge' | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => { if (visible) { setStep('choose'); setTyped(''); setError(''); } }, [visible]);

  const run = async (purge: boolean) => {
    if (lock.current) return;
    lock.current = true; setPending(purge ? 'purge' : 'keep'); setError('');
    try {
      await removeDevice(device.device_id, { purgeHistory: purge });
      onRemoved(purge);
    } catch (e) {
      setError(deviceError(e, 'Unable to remove this device. Please try again.').message);
    } finally { lock.current = false; setPending(null); }
  };

  const busy = pending !== null;
  const confirmed = normalizeDeviceCode(typed) === device.device_code;
  const close = () => { if (!busy) onClose(); };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <Pressable style={styles.back} onPress={close}>
      <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
        <View style={styles.head}>
          <Text style={styles.title} numberOfLines={2}>Remove {device.device_name}?</Text>
          <Pressable disabled={busy} onPress={close} accessibilityLabel="Close"><Ionicons name="close" size={23} color={COLORS.text}/></Pressable>
        </View>
        <Text style={styles.code}>{device.device_code}</Text>

        {step === 'choose' ? <>
          <Option icon="archive-outline" title="Remove device" busy={pending === 'keep'} disabled={busy}
            text="Stops monitoring and hides the device. Its detection history is kept, so this Device ID cannot be reused."
            onPress={() => void run(false)}/>
          <Option icon="trash-outline" danger title="Remove and delete all history" disabled={busy}
            text="Permanently deletes this device with all its detections, alerts and images. This cannot be undone."
            onPress={() => setStep('purge')}/>
        </> : <>
          <Text style={styles.warn}>This permanently deletes all detections, alerts and images for this device. It cannot be undone.</Text>
          <Text style={styles.label}>Type <Text style={{ fontWeight: '900' }}>{device.device_code}</Text> to confirm</Text>
          <TextInput value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} editable={!busy}
            placeholder={device.device_code} placeholderTextColor={COLORS.textLight} accessibilityLabel="Confirm Device ID" style={styles.input}/>
          <View style={styles.actions}>
            <Pressable disabled={busy} onPress={() => { setStep('choose'); setError(''); }} style={styles.cancel}><Text style={styles.cancelText}>Back</Text></Pressable>
            <Pressable disabled={!confirmed || busy} accessibilityRole="button" onPress={() => void run(true)} style={[styles.delete, (!confirmed || busy) && { opacity: .45 }]}>
              {pending === 'purge' ? <ActivityIndicator color="#fff"/> : <Text style={styles.deleteText}>Delete everything</Text>}
            </Pressable>
          </View>
        </>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </Pressable>
    </Pressable>
  </Modal>;
}

function Option({ icon, title, text, danger = false, busy = false, disabled, onPress }: {
  icon: any; title: string; text: string; danger?: boolean; busy?: boolean; disabled: boolean; onPress: () => void;
}) {
  const color = danger ? COLORS.danger : COLORS.primaryDark;
  return <Pressable disabled={disabled} accessibilityRole="button" onPress={onPress} style={[styles.option, disabled && !busy && { opacity: .5 }]}>
    <View style={[styles.optionIcon, { backgroundColor: danger ? '#FFF0F2' : COLORS.primarySoft }]}>
      {busy ? <ActivityIndicator color={color}/> : <Ionicons name={icon} size={20} color={color}/>}
    </View>
    <View style={{ flex: 1 }}><Text style={[styles.optionTitle, { color }]}>{title}</Text><Text style={styles.optionText}>{text}</Text></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  back: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,24,16,.45)' },
  sheet: { backgroundColor: '#fff', padding: 18, paddingBottom: 32, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontSize: 18, fontWeight: '900', color: COLORS.text },
  code: { fontSize: 11, color: COLORS.textSecondary, marginTop: 3, marginBottom: 14 },
  option: { flexDirection: 'row', gap: 11, alignItems: 'center', padding: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, marginBottom: 9 },
  optionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 12.5, fontWeight: '900' },
  optionText: { fontSize: 10, lineHeight: 14, color: COLORS.textSecondary, marginTop: 3 },
  warn: { fontSize: 11, lineHeight: 16, color: COLORS.danger, backgroundColor: '#FFF6F6', padding: 11, borderRadius: 12 },
  label: { fontSize: 11, color: COLORS.text, marginTop: 14, marginBottom: 7 },
  input: { height: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, paddingHorizontal: 12, fontSize: 13, color: COLORS.text, backgroundColor: COLORS.surfaceSoft },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancel: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border },
  cancelText: { fontSize: 11, fontWeight: '800', color: COLORS.textSecondary },
  delete: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, backgroundColor: COLORS.danger, minWidth: 140, alignItems: 'center' },
  deleteText: { fontSize: 11, fontWeight: '900', color: '#fff' },
  error: { fontSize: 11, color: COLORS.danger, marginTop: 12 },
});
