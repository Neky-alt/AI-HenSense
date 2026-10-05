import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { COLORS } from '../constants/theme';

const PROTECTED_ROUTES = [
  'device/add',
  'device/edit/[id]',
  'device/[id]/index',
  'device/[id]/history',
  'device/[id]/detections/[detectionId]',
  'quick-detection/index',
  'quick-detection/history',
  'quick-detection/[id]',
  'settings/alerts',
  'settings/cage',
  'settings/free-range',
  'profile/edit',
];

function Navigation() {
  const { session, loading, configured, recovering, recovery } = useAuth();
  useEffect(() => {
    if (!loading && recovering) router.replace('/reset-password');
  }, [loading, recovering, recovery.status]);
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={styles.caption}>Loading, please wait...</Text></View>;
  if (!configured) return <View style={styles.center}>
    <Text style={styles.title}>HenSense setup required</Text>
    <Text style={styles.caption}>Create mobile/.env using mobile/.env.example. Enter the same Supabase URL and publishable key as Web, then restart Expo.</Text>
  </View>;
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Protected guard={!session || recovering}>
      <Stack.Screen name="(auth)" />
    </Stack.Protected>
    <Stack.Protected guard={!!session && !recovering}>
      <Stack.Screen name="(tabs)" />
      {/* Folders without their own _layout register leaf routes, so list them by full name. */}
      {PROTECTED_ROUTES.map(name => <Stack.Screen key={name} name={name} />)}
    </Stack.Protected>
  </Stack>;
}
export default function RootLayout() { return <AuthProvider><StatusBar style="dark"/><Navigation/></AuthProvider>; }
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: COLORS.background },
  title: { color: COLORS.text, fontSize: 21, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  caption: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 12 },
});
