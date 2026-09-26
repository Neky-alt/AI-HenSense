import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';

export function Panel({ children, style }: { children: ReactNode; style?: any }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function PanelTitle({ title, icon, right, subtitle, compact = false }: {
  title: string; icon?: any; right?: ReactNode; subtitle?: string; compact?: boolean;
}) {
  return <View style={[styles.panelTop, compact && styles.panelTopCompact]}>
    {icon && <View style={[styles.icon, compact && styles.iconCompact]}>
      <Ionicons name={icon} size={compact ? 16 : 18} color={COLORS.primaryDark} />
    </View>}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        style={[styles.panelTitle, compact && styles.panelTitleCompact]}
        numberOfLines={compact ? 1 : undefined}
        adjustsFontSizeToFit={compact}
        minimumFontScale={0.76}
      >{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {right}
  </View>;
}

export function ActionLink({ title, onPress, compact = false }: { title: string; onPress: () => void; compact?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.link, compact && styles.linkCompact]}>
    <Text style={[styles.linkText, compact && styles.linkTextCompact]}>{title}</Text>
    <Ionicons name="chevron-forward" size={compact ? 13 : 15} color={COLORS.primaryDark} />
  </Pressable>;
}

export function StatTile({ label, value, icon, tone = 'blue', onPress, caption, weight = 1, emphasis = false }: {
  label: string; value: number | string; icon: any; tone?: 'blue' | 'purple' | 'green' | 'red' | 'gray';
  onPress?: () => void; caption?: string; weight?: number; emphasis?: boolean;
}) {
  const palette = {
    blue: ['#F1F6FF', '#486B9F'], purple: ['#F6F2FF', '#6554CB'],
    green: ['#EDF9F2', '#078149'], red: ['#FFF3F4', '#E63F48'], gray: ['#F4F6F8', '#667481'],
  } as const;
  const [bg, fg] = palette[tone];
  const content = <>
    <View style={styles.tileIcon}><Ionicons name={icon} size={16} color={fg} /></View>
    {label === 'Low-production Ratio' ? (
      <View style={styles.metricLabelLines}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}
          style={[styles.tileLabel, styles.metricFirstLine]}>Low-production</Text>
        <Text style={[styles.tileLabel, styles.metricSecondLine]}>Ratio</Text>
      </View>
    ) : (
      <Text style={[styles.tileLabel, emphasis && styles.tileLabelEmphasis]}>
        {label === 'Latest Low Count' ? 'Latest Low\nCount' : label}
      </Text>
    )}
    <Text style={[styles.tileValue, emphasis && styles.tileValueEmphasis, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
      {value}
    </Text>
    {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : null}
  </>;
  const tileStyle = [styles.tile, { flex: weight, backgroundColor: bg }];
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [...tileStyle, pressed && { opacity: 0.8 }]}>{content}</Pressable>
    : <View style={tileStyle}>{content}</View>;
}

export function Pill({ text, tone = 'green' }: { text: string; tone?: 'green' | 'red' | 'gray' | 'amber' }) {
  const palette = {
    green: ['#E6F9ED', '#08723E'], red: ['#FFEBED', '#D8303B'],
    gray: ['#F0F3F5', '#62717B'], amber: ['#FFF2DD', '#AF6C05'],
  } as const;
  return <View style={[styles.pill, { backgroundColor: palette[tone][0] }]}>
    <Text style={[styles.pillText, { color: palette[tone][1] }]}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#fff', borderRadius: 20, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#123920', shadowOpacity: 0.035, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 11 },
  panelTopCompact: { gap: 6, marginBottom: 9 },
  icon: { height: 34, width: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: COLORS.primarySoft },
  iconCompact: { height: 30, width: 30, borderRadius: 10 },
  panelTitle: { fontSize: 15, fontWeight: '900', letterSpacing: -0.25, color: COLORS.text },
  panelTitleCompact: { fontSize: 13.5, letterSpacing: -0.32 },
  subtitle: { fontSize: 10.5, color: COLORS.textSecondary, marginTop: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 0, paddingVertical: 6, flexShrink: 0 },
  linkCompact: { paddingVertical: 4 },
  linkText: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark },
  linkTextCompact: { fontSize: 10 },
  tile: { minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, minHeight: 124 },
  tileIcon: { width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFFDD', marginBottom: 5 },
  tileLabel: { fontSize: 9.5, fontWeight: '700', color: COLORS.textSecondary, textAlign: 'center', lineHeight: 11.6, minHeight: 42, textAlignVertical: 'center' },
  tileLabelEmphasis: { fontSize: 9.6, lineHeight: 12.5 },
  metricLabelLines: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  metricFirstLine: { width: '100%', minHeight: 0, fontSize: 10.3, lineHeight: 13, fontWeight: '800' },
  metricSecondLine: { minHeight: 0, fontSize: 10, lineHeight: 13, fontWeight: '800' },
  tileValue: { fontSize: 20, fontWeight: '900', marginTop: 2, letterSpacing: -0.45, textAlign: 'center' },
  tileValueEmphasis: { fontSize: 23 },
  caption: { fontSize: 8.5, color: COLORS.textLight, marginTop: 3 },
  pill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '800' },
});
