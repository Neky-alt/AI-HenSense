import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
export default function BackendStatus({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (!loading && !error) return null;
  return <View style={{ padding: 14, gap: 8 }}>
    {loading ? <><ActivityIndicator color={COLORS.primary}/><Text>Loading, please wait...</Text></> : <><Text accessibilityRole="alert" style={{ color: COLORS.danger }}>{error}</Text><Pressable onPress={retry} accessibilityRole="button"><Text style={{ color: COLORS.primaryDark }}>Retry</Text></Pressable></>}
  </View>;
}
