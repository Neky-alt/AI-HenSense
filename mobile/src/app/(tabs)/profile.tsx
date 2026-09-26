import { userMessage } from '../../lib/userMessages';
import BackendStatus from '../../components/BackendStatus';
import { useBackendData } from '../../hooks/useBackendData';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import FarmHero from '../../components/FarmHero';
import AccountAvatar from '../../components/AccountAvatar';
import { Panel } from '../../components/DesignKit';
import { COLORS } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { getAlerts } from '../../services/detectionService';
import { getCloudProfile } from '../../services/cloudProfileService';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [profileError, setProfileError] = useState('');
  const fallbackName = typeof user?.user_metadata?.display_name === 'string' && user.user_metadata.display_name.trim()
    ? user.user_metadata.display_name.trim() : user?.email?.split('@')[0] || 'Account';

  useFocusEffect(useCallback(() => {
    let active = true;
    const refresh = async () => {
      if (!user?.id) return;
      try {
        const profile = await getCloudProfile();
        if (active) { setAvatarUrl(profile.avatarUrl); setName(profile.displayName); setProfileError(''); }
      } catch (error) {
        if (active) setProfileError(userMessage(error, 'Could not refresh your profile.'));
      }
    };
    void refresh();
    return () => { active = false; };
  }, [user?.id]));

  const alertState=useBackendData(getAlerts);
  const active=(alertState.data??[]).filter(a=>a.alert_status==='active').length;
  const logout = () => Alert.alert('Sign out?', 'End the HenSense session on this phone?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: async () => {
      setPending(true);
      try { await signOut(); setAvatarUrl(null); setName(''); }
      catch (error) { Alert.alert('Unable to sign out', userMessage(error, 'Please try again.')); }
      finally { setPending(false); }
    } },
  ]);

  return <AppScreen>
    <FarmHero alertCount={active} /><BackendStatus {...alertState}/>
    <Panel style={styles.profile}>
      <AccountAvatar name={name || fallbackName} uri={avatarUrl} size={61} />
      <View style={styles.profileBody}>
        <Text style={styles.name} numberOfLines={2}>{name || fallbackName}</Text>
        <Text style={styles.account} numberOfLines={2}>{user?.email || 'Email unavailable'}</Text>
        <Text style={styles.farmName}>{user?.email_confirmed_at ? 'Verified account' : 'Email not verified'}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => router.push('/profile/edit')} style={styles.edit}>
        <Ionicons name="create-outline" size={17} color={COLORS.primaryDark}/><Text style={styles.editText}>Edit</Text>
      </Pressable>
    </Panel>
    {!!profileError && <Text style={styles.error}>Cloud profile: {profileError}</Text>}
    <Text style={styles.group}>ACCOUNT & SETTINGS</Text>
    <MenuRow title="Notification Settings" subtitle="Manage alert preferences" icon="notifications-outline" tone="red" onPress={() => router.push('/settings/alerts')} />
    <MenuRow title="Cage Monitoring Settings" subtitle="Intervals, schedules and thresholds" icon="grid-outline" onPress={() => router.push('/settings/cage')} />
    <MenuRow title="Free-range Monitoring Settings" subtitle="Snapshot intervals and thresholds" icon="leaf-outline" onPress={() => router.push('/settings/free-range')} />
    <Pressable disabled={pending} onPress={logout} style={styles.signOut}><Ionicons name="log-out-outline" size={18} color={COLORS.danger}/><Text style={styles.signOutText}>{pending ? 'Signing out…' : 'Sign out'}</Text></Pressable>
    <Text style={styles.note}>Account information syncs with HenSense Web when each app refreshes or reopens its Profile. Monitoring data is read from the shared Backend. Device and monitoring configuration is read-only in Mobile Stage 1.</Text>
  </AppScreen>;
}
function MenuRow({ title, subtitle, icon, tone = 'green', onPress }: { title: string; subtitle: string; icon: any; tone?: 'green' | 'red'; onPress: () => void }) {
  const bg = tone === 'red' ? '#FFF0F2' : COLORS.primarySoft;
  const color = tone === 'red' ? COLORS.danger : COLORS.primaryDark;
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.menu}>
    <View style={[styles.menuIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={21} color={color}/></View>
    <View style={{ flex: 1 }}><Text style={styles.menuName}>{title}</Text><Text style={styles.menuSub}>{subtitle}</Text></View>
    <Ionicons name="chevron-forward" size={20} color={COLORS.textLight}/>
  </Pressable>;
}
const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 17 },
  profileBody: { flex: 1, minWidth: 0 },
  name: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  account: { fontSize: 11, color: COLORS.textSecondary, marginTop: 3 },
  farmName: { fontSize: 9.6, color: COLORS.primaryDark, fontWeight: '800', backgroundColor: COLORS.primarySoft, borderRadius: 11, paddingHorizontal: 9, paddingVertical: 5, alignSelf: 'flex-start', overflow: 'hidden', marginTop: 8 },
  edit: { flexDirection: 'row', gap: 4, alignItems: 'center', alignSelf: 'flex-start', backgroundColor: COLORS.surfaceSoft, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 8 },
  editText: { fontSize: 10, fontWeight: '800', color: COLORS.primaryDark },
  group: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: COLORS.textSecondary, marginTop: 14, marginBottom: 11 },
  menu: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 17, padding: 13, flexDirection: 'row', gap: 11, alignItems: 'center', marginBottom: 10 },
  menuIcon: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  menuName: { fontSize: 13.5, fontWeight: '900', color: COLORS.text },
  menuSub: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 3 },
  signOut: { borderRadius: 12, borderColor: '#FAD3D4', borderWidth: 1, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#FFF8F8', marginTop: 6 },
  signOutText: { fontSize: 12, fontWeight: '800', color: COLORS.danger },
  note: { fontSize: 10.5, lineHeight: 15, color: COLORS.textSecondary, marginTop: 15, marginBottom: 16 },
  error: { fontSize: 11, color: COLORS.danger, marginBottom: 4 },
});
