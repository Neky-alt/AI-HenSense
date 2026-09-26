import { userMessage } from '../../lib/userMessages';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AppScreen from '../../components/AppScreen';
import AccountAvatar from '../../components/AccountAvatar';
import { COLORS } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { getCloudProfile, removeCloudAvatar, updateCloudAvatar } from '../../services/cloudProfileService';

export default function EditProfile() {
  const { user } = useAuth();
  const fallback = typeof user?.user_metadata?.display_name === 'string'
    ? user.user_metadata.display_name.trim() : user?.email?.split('@')[0] || '';
  const [name, setName] = useState(fallback);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [success, setSuccess] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    const load = async () => {
      if (!user?.id) return;
      try {
        const p = await getCloudProfile();
        if (active) { setName(p.displayName); setAvatarUrl(p.avatarUrl); setError(''); }
      } catch (e) { if (active) setError(userMessage(e, 'Could not load your profile.')); }
    };
    void load();
    return () => { active = false; };
  }, [user?.id]));

  const choosePhoto = async () => {
    if (photoSaving || !user?.id) return;
    setPhotoError(''); setSuccess('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.68, base64: true,
      });
      if (result.canceled || !result.assets.length) return;
      const selected = result.assets[0];
      setPreviewUri(selected.uri); setPhotoSaving(true);
      const url = await updateCloudAvatar(user.id, selected);
      setAvatarUrl(url); setSuccess('Profile photo updated. It is now shared with HenSense Web.');
    } catch (e) {
      setPhotoError(userMessage(e, 'Unable to upload profile photo.'));
    } finally { setPreviewUri(null); setPhotoSaving(false); }
  };

  const removePhoto = () => {
    if (photoSaving || !user?.id || !avatarUrl) return;
    Alert.alert('Remove profile photo?', 'The default initial will appear on Web and Mobile.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setPhotoSaving(true); setPhotoError(''); setSuccess('');
        try { await removeCloudAvatar(user.id); setAvatarUrl(null); setSuccess('Profile photo removed from your account.'); }
        catch (e) { setPhotoError(userMessage(e, 'Unable to remove profile photo.')); }
        finally { setPhotoSaving(false); }
      } },
    ]);
  };

  const save = async () => {
    if (saving) return;
    if (!name.trim()) { setError('Display name cannot be empty.'); return; }
    setError(''); setSuccess(''); setSaving(true);
    try {
      if (!supabase) throw new Error('Supabase not configured.');
      const { error: updateError } = await supabase.auth.updateUser({ data: { display_name: name.trim() } });
      if (updateError) throw updateError;
      setSuccess('Display name saved. Web will refresh it when focused.');
    } catch (e) { setError(userMessage(e, 'Unable to update your account.')); }
    finally { setSaving(false); }
  };
  const since = user?.created_at ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(user.created_at)) : '—';
  return <AppScreen>
    <Pressable onPress={() => router.back()} style={s.back}><Ionicons name="arrow-back" size={18} color={COLORS.textSecondary}/><Text style={s.backText}>Profile</Text></Pressable>
    <Text style={s.heading}>Account Information</Text><Text style={s.subtitle}>Edit your shared HenSense account.</Text>
    <View style={s.card}>
      <Text style={s.label}>Profile photo</Text>
      <View style={s.photoRow}>
        <AccountAvatar name={name || fallback} uri={previewUri || avatarUrl} size={76}/>
        <View style={s.photoActions}>
          <Pressable disabled={photoSaving} onPress={choosePhoto} style={[s.chooseButton, photoSaving && { opacity: .6 }]}>
            {photoSaving ? <ActivityIndicator color={COLORS.primaryDark}/> : <Ionicons name="images-outline" size={16} color={COLORS.primaryDark}/>}
            <Text style={s.chooseText}>{photoSaving ? 'Uploading…' : 'Change photo'}</Text>
          </Pressable>
          {!!avatarUrl && <Pressable disabled={photoSaving} onPress={removePhoto} style={s.removeButton}><Text style={s.removeText}>Remove photo</Text></Pressable>}
          <Text style={s.photoHelp}>JPG, PNG or WebP · Up to 2 MB</Text>
        </View>
      </View>
      {!!photoError && <Text style={s.error}>{photoError}</Text>}
      <Text style={s.label}>Display Name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} maxLength={60} placeholder="Your display name"/>
      <Text style={s.label}>Email</Text>
      <View style={[s.input, s.readonly]}><Text style={s.readonlyText}>{user?.email || '—'}</Text></View>
      <Text style={s.note}>Email changes are not included in the current scope.</Text>
      <Text style={s.label}>Email status: {user?.email_confirmed_at ? 'Verified' : 'Not verified'}</Text>
      <Text style={s.label}>Member since: {since}</Text>
      {!!error && <Text style={s.error}>{error}</Text>}
      {!!success && <Text style={s.success}>{success}</Text>}
      <View style={s.actions}>
        <Pressable style={s.cancel} onPress={() => router.back()}><Text style={s.cancelText}>Back</Text></Pressable>
        <Pressable disabled={saving || photoSaving} style={[s.save, (saving || photoSaving) && { opacity: .6 }]} onPress={save}>
          {saving ? <ActivityIndicator color="#fff"/> : <Text style={s.saveText}>Save account</Text>}
        </Pressable>
      </View>
    </View>
  </AppScreen>;
}
const s = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, alignSelf: 'flex-start' },
  backText: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  heading: { fontSize: 21, fontWeight: '900', color: COLORS.text },
  subtitle: { fontSize: 11, color: COLORS.textSecondary, marginTop: 5, marginBottom: 15 },
  card: { padding: 15, borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  label: { fontSize: 11, fontWeight: '800', color: COLORS.text, marginBottom: 7, marginTop: 8 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 16 },
  photoActions: { flex: 1, alignItems: 'flex-start', gap: 5 },
  chooseButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  chooseText: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark },
  removeButton: { paddingVertical: 5 },
  removeText: { fontSize: 11, fontWeight: '700', color: COLORS.danger },
  photoHelp: { fontSize: 10, color: COLORS.textSecondary },
  input: { minHeight: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, paddingHorizontal: 12, fontSize: 13, color: COLORS.text, backgroundColor: COLORS.surfaceSoft, marginBottom: 12, justifyContent: 'center' },
  readonly: { backgroundColor: '#F3F6F5' }, readonlyText: { fontSize: 12, color: COLORS.textSecondary },
  note: { fontSize: 10.5, color: COLORS.textSecondary, marginBottom: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 18 },
  cancel: { paddingHorizontal: 13, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  cancelText: { fontSize: 11, fontWeight: '800', color: COLORS.textSecondary },
  save: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, backgroundColor: COLORS.primary, minWidth: 112, alignItems: 'center' },
  saveText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  error: { color: COLORS.danger, fontSize: 11, marginTop: 7 },
  success: { color: COLORS.primaryDark, fontSize: 11, marginTop: 7 },
});
