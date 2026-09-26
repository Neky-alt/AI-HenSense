import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from '../lib/supabase';

/** Shared with HenSense Web: user_metadata.display_name/avatar_path + private Storage bucket. */
const BUCKET = 'hensense-avatars';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const client = () => { if (!supabase) throw new Error('Supabase is not configured.'); return supabase; };

export type CloudProfile = {
  displayName: string;
  avatarUrl: string | null;
  avatarPath: string | null;
};

export async function getCloudProfile(): Promise<CloudProfile> {
  const { data: { user }, error } = await client().auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Please sign in again.');
  const displayName = typeof user.user_metadata?.display_name === 'string' && user.user_metadata.display_name.trim()
    ? user.user_metadata.display_name.trim()
    : user.email?.split('@')[0] || 'Account';
  const avatarPath = typeof user.user_metadata?.avatar_path === 'string' &&
    user.user_metadata.avatar_path.startsWith(`${user.id}/`)
    ? user.user_metadata.avatar_path : null;
  if (!avatarPath) return { displayName, avatarPath: null, avatarUrl: null };
  const { data, error: signedError } = await client().storage.from(BUCKET).createSignedUrl(avatarPath, 3600);
  if (signedError) throw signedError;
  return { displayName, avatarPath, avatarUrl: data.signedUrl };
}

/** Expo ImagePicker base64 is JPEG. Decode into ArrayBuffer for React Native Storage uploads. */
function imageBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  const clean = base64.replace(/\s/g, '');
  const padded = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const length = (clean.length / 4) * 3 - padded;
  if (!Number.isInteger(length) || length < 1 || length > 2 * 1024 * 1024) {
    throw new Error('Please choose a photo smaller than 2 MB.');
  }
  const result = new Uint8Array(length);
  let write = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = table[clean.charCodeAt(i)] ?? -1;
    const b = table[clean.charCodeAt(i + 1)] ?? -1;
    const c = clean[i + 2] === '=' ? 0 : (table[clean.charCodeAt(i + 2)] ?? -1);
    const d = clean[i + 3] === '=' ? 0 : (table[clean.charCodeAt(i + 3)] ?? -1);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid image data. Choose another photo.');
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    result[write++] = (bits >>> 16) & 255;
    if (write < length) result[write++] = (bits >>> 8) & 255;
    if (write < length) result[write++] = bits & 255;
  }
  return result.buffer;
}

export async function updateCloudAvatar(userId: string, asset: ImagePickerAsset): Promise<string> {
  if (!asset.uri) throw new Error('No photo was selected.');
  // With allowsEditing + base64, ImagePicker returns a compact JPEG regardless of the source format.
  if (!asset.base64) throw new Error('Photo data was not returned. Please select it again.');
  const bytes = imageBase64ToArrayBuffer(asset.base64);
  const mime = 'image/jpeg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 12)}.jpg`;
  const { error: uploadError } = await client().storage.from(BUCKET).upload(path, bytes, {
    contentType: mime, upsert: false, cacheControl: '3600',
  });
  if (uploadError) throw uploadError;
  try {
    const { data: { user }, error: userError } = await client().auth.getUser();
    if (userError) throw userError;
    if (!user || user.id !== userId) throw new Error('Your account changed; sign in again.');
    const oldPath: unknown = user.user_metadata?.avatar_path;
    const { error: metadataError } = await client().auth.updateUser({ data: { avatar_path: path } });
    if (metadataError) throw metadataError;
    const { data, error: signedError } = await client().storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signedError) throw signedError;
    if (typeof oldPath === 'string' && oldPath.startsWith(`${userId}/`) && oldPath !== path) {
      void client().storage.from(BUCKET).remove([oldPath]);
    }
    return data.signedUrl;
  } catch (error) {
    const { data: { user } } = await client().auth.getUser();
    if (user?.user_metadata?.avatar_path !== path) void client().storage.from(BUCKET).remove([path]);
    throw error;
  }
}

export async function removeCloudAvatar(userId: string): Promise<void> {
  const { data: { user }, error } = await client().auth.getUser();
  if (error) throw error;
  if (!user || user.id !== userId) throw new Error('Please sign in again.');
  const oldPath: unknown = user.user_metadata?.avatar_path;
  const { error: metadataError } = await client().auth.updateUser({ data: { avatar_path: null } });
  if (metadataError) throw metadataError;
  if (typeof oldPath === 'string' && oldPath.startsWith(`${userId}/`)) {
    const { error: removeError } = await client().storage.from(BUCKET).remove([oldPath]);
    if (removeError) console.warn('Old avatar cleanup pending:', removeError.message);
  }
}
