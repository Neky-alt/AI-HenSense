import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { formatElapsed, formatLocalDate, getGreeting } from '../utils/time';

const brandIcon = require('../../assets/brand/hensense-logo.png');
const farmland = require('../../assets/brand/hensense-hero.png');

/** Shared header: original supplied hero image, without added washes or gradient strips. */
export default function FarmHero({
  title, subtitle, home = false, alertCount = 0, updatedAt = null,
}: {
  title?: string;
  subtitle?: string;
  home?: boolean;
  alertCount?: number;
  updatedAt?: string | null;
}) {
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []));
  const lastUpdate = formatElapsed(updatedAt, now);
  const compact = !home && !title;
  return (
    <View style={styles.wrap}>
      <ImageBackground
        source={farmland}
        resizeMode="cover"
        imageStyle={styles.image}
        style={[styles.hero, home ? styles.homeHero : compact ? styles.compactHero : styles.pageHero]}
      >
        <View style={styles.top}>
          <View style={styles.brand} accessible accessibilityLabel="HenSense">
            <Image source={brandIcon} resizeMode="contain" style={styles.brandIcon} />
            <View><Text style={styles.brandTop}>Hen</Text><Text style={styles.brandBottom}>Sense</Text></View>
          </View>
          <View style={{flexDirection:'row',gap:8}}>
          {home&&<Pressable accessibilityRole="button" accessibilityLabel="Quick Detection camera" onPress={()=>router.push('/quick-detection')} style={styles.bell}><Ionicons name="camera-outline" size={21} color={COLORS.text}/></Pressable>}
          <Pressable
            accessibilityRole="button" accessibilityLabel="View alerts"
            onPress={() => router.push('/alerts')} style={styles.bell}
          >
            <Ionicons name="notifications-outline" size={21} color={COLORS.text} />
            {alertCount > 0 && <View style={styles.dot}>
              <Text style={styles.dotText}>{alertCount > 9 ? '9+' : alertCount}</Text>
            </View>}
          </Pressable>
          </View>
        </View>
        {!compact && <View style={styles.heroText}>
          {home ? <>
            <View style={styles.greetingRow}>
              <Ionicons name="sunny-outline" size={23} color="#E7B52B" />
              <Text style={styles.greeting} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.84}>
                {getGreeting(now)}
              </Text>
            </View>
            <Text style={styles.subtitle} numberOfLines={2}>
              {formatLocalDate(now)} · {lastUpdate ? `Local Backend · Updated ${lastUpdate}` : 'Local Backend · No detections yet'}
            </Text>
          </> : <>
            <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.88}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
          </>}
        </View>}
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: -18, marginBottom: 6 },
  hero: { justifyContent: 'space-between', overflow: 'hidden', backgroundColor: COLORS.background },
  homeHero: { height: 182 },
  pageHero: { height: 182 },
  compactHero: { height: 182 },
  image: { opacity: 1 },
  top: { paddingHorizontal: 18, paddingTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 86 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 88, width: 184 },
  brandIcon: { width: 92, height: 92 },
  brandTop: { fontSize: 21, fontWeight: '900', lineHeight: 21, color: '#513607', letterSpacing: -0.55 },
  brandBottom: { fontSize: 21, fontWeight: '900', lineHeight: 21, color: '#A66E09', letterSpacing: -0.55 },
  bell: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#FFF9EEED', borderWidth: 1, borderColor: '#EADBBE' },
  dot: { position: 'absolute', right: -5, top: -6, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.danger, borderWidth: 2, borderColor: '#fff' },
  dotText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  heroText: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 23 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greeting: { flexShrink: 1, fontSize: 20, lineHeight: 25, fontWeight: '900', letterSpacing: -0.5, color: COLORS.text },
  title: { fontSize: 21, lineHeight: 26, fontWeight: '900', letterSpacing: -0.5, color: COLORS.text },
  subtitle: { fontSize: 11, color: '#6E654E', marginTop: 5, lineHeight: 15, maxWidth: '89%' },
});
