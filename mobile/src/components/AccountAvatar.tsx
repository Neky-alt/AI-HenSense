import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
export default function AccountAvatar({ name, uri, size = 61 }: { name: string; uri: string | null; size?: number }) {
  return <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
    {uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityLabel={`${name} profile photo`} />
      : <Text style={[styles.initial, { fontSize: size * 0.46 }]}>{(name || 'A').charAt(0).toUpperCase()}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  circle: { backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontWeight: '900', color: COLORS.primaryDark },
});
