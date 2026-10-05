import BackendStatus from '../../components/BackendStatus';
import { useBackendData } from '../../hooks/useBackendData';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import FarmHero from '../../components/FarmHero';
import DeviceCard from '../../components/DeviceCard';
import { COLORS } from '../../constants/theme';
import { getDevices } from '../../services/deviceStorage';
import { deviceManagementEnabled } from '../../services/deviceService';
import type { Device, MonitoringStatus } from '../../types/device';

type Filter = 'all' | MonitoringStatus | 'offline';
type Sort = 'default' | 'low-desc' | 'low-asc' | 'name-asc' | 'name-desc';
const filters: Filter[] = ['all', 'normal', 'warning', 'offline'];
const sortLabels: Record<Sort, string> = {
  default: 'Default order', 'low-desc': 'Low ratio: high to low',
  'low-asc': 'Low ratio: low to high', 'name-asc': 'Device name: A to Z', 'name-desc': 'Device name: Z to A',
};

export default function CageScreen() {
  const { cwFilter, cwSort, cwNavId } = useLocalSearchParams<{cwFilter?:string;cwSort?:string;cwNavId?:string}>();
  const handledNav = useRef('');
  const state = useBackendData(getDevices);
  const devices = state.data ?? [];
  const reload = state.retry;
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [query, setQuery] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  // Apply each Home shortcut once, without overwriting a filter when returning from a device detail.
  useEffect(() => {
    if (!cwNavId || handledNav.current === cwNavId) return;
    handledNav.current = cwNavId;
    setFilter(filters.includes(cwFilter as Filter) ? cwFilter as Filter : 'all');
    setSort((Object.keys(sortLabels) as Sort[]).includes(cwSort as Sort) ? cwSort as Sort : 'default');
    setQuery('');
  }, [cwFilter, cwSort, cwNavId]);

  const cages = useMemo(() => devices.filter(d => d.farming_type === 'caged'), [devices]);
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const matching = cages.filter(d => {
      const matchingFilter = filter === 'all' || (filter === 'offline' ? d.device_status === 'offline'
        : d.device_status === 'online' && d.monitoring_status === filter);
      return matchingFilter && (!q || d.device_name.toLocaleLowerCase().includes(q) || d.device_code.toLocaleLowerCase().includes(q));
    });
    if (sort === 'low-desc') matching.sort((a, b) => (b.low_ratio ?? -1) - (a.low_ratio ?? -1));
    if (sort === 'low-asc') matching.sort((a, b) => (a.low_ratio ?? 99) - (b.low_ratio ?? 99));
    if (sort === 'name-asc') matching.sort((a, b) => a.device_name.localeCompare(b.device_name));
    if (sort === 'name-desc') matching.sort((a, b) => b.device_name.localeCompare(a.device_name));
    return matching;
  }, [cages, filter, query, sort]);

  return <AppScreen>
    <FarmHero title="Cage Monitoring" subtitle="Latest fixed-cage detection results" /><BackendStatus {...state}/>
    <View style={styles.toolbar}>
      <Text style={styles.total}>{cages.length} devices</Text>
      <View style={styles.toolbarButtons}>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push('/settings/cage')}>
          <Ionicons name="settings-outline" size={15} color={COLORS.primaryDark} /><Text style={styles.secondaryText}>Settings</Text>
        </Pressable>
        {deviceManagementEnabled() && <Pressable accessibilityRole="button" accessibilityLabel="Add cage device" style={styles.add} onPress={() => router.push({ pathname: '/device/add', params: { farming_type: 'caged' } })}>
          <Ionicons name="add" size={21} color="#fff" />
        </Pressable>}
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterRow}>
      {filters.map(f => <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
        {f !== 'all' && <View style={[styles.dot, { backgroundColor: f === 'normal' ? COLORS.normal : f === 'warning' ? COLORS.danger : COLORS.offline }]} />}
        <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}</Text>
      </Pressable>)}
    </ScrollView>
    <View style={styles.searchSortRow}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={17} color={COLORS.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search name or device ID" placeholderTextColor={COLORS.textLight}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel="Search cage devices" style={styles.searchInput} />
        {query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={17} color={COLORS.textSecondary} />
        </Pressable>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Sort devices: ${sortLabels[sort]}`} style={styles.sort} onPress={() => setSortOpen(true)}>
        <Ionicons name="swap-vertical-outline" size={16} color={COLORS.primaryDark} /><Text style={styles.sortText}>Sort</Text>
      </Pressable>
    </View>
    {sort !== 'default' && <Text style={styles.sortSummary}>{sortLabels[sort]}</Text>}
    {list.map(d => <DeviceCard key={d.device_id} device={d} />)}
    {!state.loading && !state.error && !list.length && <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No devices found</Text>
      <Text style={styles.emptyText}>{cages.length ? 'No devices match this filter or search.' : deviceManagementEnabled() ? 'Tap + to add your first cage device.' : 'No cage devices are available in this snapshot.'}</Text>
    </View>}
    <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
      <Pressable style={styles.modalBack} onPress={() => setSortOpen(false)}>
        <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Sort Cage Devices</Text>
          {(Object.keys(sortLabels) as Sort[]).map(v => <Pressable key={v} onPress={() => { setSort(v); setSortOpen(false); }} style={[styles.sortOption, sort === v && styles.sortOptionActive]}>
            <Text style={[styles.sortOptionText, sort === v && { color: COLORS.primaryDark, fontWeight: '800' }]}>{sortLabels[v]}</Text>
            {sort === v && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
  </AppScreen>;
}

const styles = StyleSheet.create({
  toolbar: { marginTop: 5, marginBottom: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontSize: 11, color: COLORS.textSecondary },
  toolbarButtons: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 38, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  secondaryText: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark },
  add: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary },
  filters: { marginBottom: 12 }, filterRow: { gap: 7, paddingRight: 5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { backgroundColor: COLORS.primarySoft, borderColor: '#E6C36B' }, dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary }, chipTextActive: { color: COLORS.primaryDark },
  searchSortRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 13 },
  searchBox: { flex: 1, minWidth: 0, height: 43, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, minWidth: 0, fontSize: 11.5, color: COLORS.text, paddingVertical: 8 },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 43, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  sortText: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark },
  sortSummary: { fontSize: 10, color: COLORS.textSecondary, marginTop: -5, marginBottom: 11 },
  empty: { padding: 24, alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16 },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text }, emptyText: { fontSize: 11, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },
  modalBack: { flex: 1, backgroundColor: 'rgba(10,25,15,.35)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 16, maxWidth: 480, width: '100%', alignSelf: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '900', color: COLORS.text, marginBottom: 10 },
  sortOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  sortOptionActive: { backgroundColor: COLORS.primarySoft }, sortOptionText: { fontSize: 12, color: COLORS.text },
});
