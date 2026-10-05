import BackendStatus from '../../../components/BackendStatus';
import { useBackendData } from '../../../hooks/useBackendData';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import AppScreen from '../../../components/AppScreen';
import { MonitoringBadge } from '../../../components/StatusBadge';
import { COLORS } from '../../../constants/theme';
import { userMessage } from '../../../lib/userMessages';
import { localBackendWrites } from '../../../services/apiClient';
import { deleteDetectionImage, deleteDetectionRecord, getDetectionsByDeviceId } from '../../../services/detectionService';
import type { Detection } from '../../../types/detection';
import { formatRatio } from '../../../utils/ratio';

type DeleteKind = 'image' | 'record';
const formatTime = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Same actions as Web Device History: delete images only (record kept) or delete the whole record. */
export default function HistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useBackendData(getDetectionsByDeviceId, String(id));
  const list = state.data ?? [];
  const canWrite = localBackendWrites();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const lock = useRef(false);

  const run = async (d: Detection, kind: DeleteKind) => {
    if (lock.current) return;
    lock.current = true; setBusy(d.detection_id); setNotice(null);
    try {
      if (kind === 'image') await deleteDetectionImage(String(id), d.detection_id);
      else await deleteDetectionRecord(String(id), d.detection_id);
      setNotice({ ok: true, text: kind === 'image' ? 'Detection image deleted.' : 'Detection record deleted.' });
      state.retry();
    } catch (error) {
      setNotice({ ok: false, text: userMessage(error, 'Unable to delete. Please try again.') });
    } finally { lock.current = false; setBusy(null); }
  };

  const confirm = (d: Detection, kind: DeleteKind) => Alert.alert(
    kind === 'image' ? 'Delete detection image?' : 'Delete detection record?',
    `${formatTime(d.detected_at)}\n\n` + (kind === 'image'
      ? 'This permanently removes the original and annotated images, on this system and in the cloud. Counts, ratios, status and timestamp stay in Detection History.'
      : 'This removes the record from Detection History and permanently deletes its images, on this system and in the cloud.'),
    [{ text: 'Cancel', style: 'cancel' },
     { text: kind === 'image' ? 'Delete Image' : 'Delete Record', style: 'destructive', onPress: () => void run(d, kind) }],
  );

  return <AppScreen>
    <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={18} color={COLORS.textSecondary}/><Text style={styles.backText}>Back to Device</Text></Pressable>
    <Text style={styles.h1}>Detection History</Text>
    <BackendStatus {...state}/>
    <Text style={styles.sub}>All saved detection records for this device. Images are kept for 30 days; counts and records stay.</Text>
    {!!notice && <Text accessibilityRole="alert" style={[styles.notice, { color: notice.ok ? COLORS.primaryDark : COLORS.danger }]}>{notice.text}</Text>}
    {list.map(d => {
      const hasImage = !!(d.screenshot_url || d.annotated_image_url);
      const rowBusy = busy === d.detection_id;
      return <View key={d.detection_id} style={[styles.row, rowBusy && { opacity: .5 }]}>
        <View style={styles.top}>
          <Pressable style={{ flex: 1 }} onPress={() => router.push(`/device/${id}/detections/${d.detection_id}`)}>
            <Text style={styles.time}>{formatTime(d.detected_at)}</Text>
            <Text style={styles.counts}>{d.trigger_type === 'manual' ? 'Manual Detection · ' : ''}Normal {d.normal_count} / Low {d.low_count} / Total {d.total_count}</Text>
            <Text style={styles.ratios}>{formatRatio(d.normal_ratio)} normal · {formatRatio(d.low_ratio)} low</Text>
          </Pressable>
          <MonitoringBadge status={d.monitoring_status}/>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => router.push(`/device/${id}/detections/${d.detection_id}`)}><Text style={styles.view}>View</Text></Pressable>
          {hasImage
            ? canWrite && <Pressable disabled={!!busy} accessibilityRole="button" onPress={() => confirm(d, 'image')}><Text style={styles.action}>Delete image</Text></Pressable>
            : <Text style={styles.missing}>Image unavailable</Text>}
          {canWrite && <Pressable disabled={!!busy} accessibilityRole="button" onPress={() => confirm(d, 'record')}><Text style={[styles.action, { color: COLORS.danger }]}>Delete record</Text></Pressable>}
        </View>
      </View>;
    })}
    {!state.loading && !state.error && !list.length && <Text style={styles.empty}>No detection records remain.</Text>}
  </AppScreen>;
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 14, alignSelf: 'flex-start' },
  backText: { fontSize: 10.5, fontWeight: '700', color: COLORS.textSecondary },
  h1: { fontSize: 21, fontWeight: '900', color: COLORS.text, letterSpacing: -.6 },
  sub: { fontSize: 10.5, lineHeight: 15, color: COLORS.textSecondary, marginTop: 5, marginBottom: 14 },
  notice: { fontSize: 11, fontWeight: '700', marginBottom: 10 },
  row: { padding: 13, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: COLORS.surface, marginBottom: 9 },
  top: { flexDirection: 'row', gap: 10 },
  time: { fontSize: 11, fontWeight: '800', color: COLORS.text },
  counts: { fontSize: 9.5, color: COLORS.textSecondary, marginTop: 4 },
  ratios: { fontSize: 9, color: COLORS.textLight, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  view: { fontSize: 10.5, fontWeight: '800', color: COLORS.primaryDark },
  action: { fontSize: 10.5, fontWeight: '700', color: COLORS.primaryDark },
  missing: { fontSize: 10, color: COLORS.textLight },
  empty: { fontSize: 11, color: COLORS.textSecondary, marginTop: 20 },
});
