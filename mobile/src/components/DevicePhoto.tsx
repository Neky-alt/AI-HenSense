import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/apiClient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Device } from '../types/device';
import { COLORS } from '../constants/theme';
export default function DevicePhoto({ device, height = 156, caption }: { device: Device; height?: number; caption?: string }) {
  return <Photo key={`${device.device_id}:${device.latest_detection_id}:${device.annotated_image_url}:${device.image_url}`} original={device.image_url} annotated={device.annotated_image_url} height={height} caption={caption ?? `Detection image for ${device.device_name}`}/>;
}
export function Photo({ original, annotated, height, caption, headers }: { original?: string | null; annotated?: string | null; height: number; caption: string; headers?: Record<string,string> }) {
  const {session}=useAuth();
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const uri = [annotated, original].find(url => !!url && !failed.includes(url));
  let local=false;
  try{local=!!uri&&new URL(uri).origin===new URL(API_BASE_URL).origin&&/^\/api\/v1\/devices\/[^/]+\/detections\/[^/]+\/(image|annotated-image)$/.test(new URL(uri).pathname);}catch{}
  const imageHeaders=headers ?? (local&&session?{Authorization:`Bearer ${session.access_token}`}:undefined);
  if(!session)return null;
  return <View accessibilityLabel={caption} onLayout={e => setWidth(e.nativeEvent.layout.width)} style={[styles.frame, { height }]}>
    {uri && width > 0 ? <Image key={`${session.user.id}:${uri}`} source={{ uri, headers:imageHeaders, ...(imageHeaders ? {cache: 'reload' as const} : {}) }} style={{ width, height }} resizeMode="contain" onError={() => setFailed(previous => [...previous, uri])}/> : !uri ? <View style={styles.placeholder}><Ionicons name="image-outline" size={23} color={COLORS.offline}/><Text style={styles.placeholderText}>Detection image unavailable</Text></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: COLORS.offlineSoft },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText: { color: COLORS.textSecondary, fontSize: 11 },
});
