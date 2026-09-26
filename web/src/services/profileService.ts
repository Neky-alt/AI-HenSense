import { supabase } from '../lib/supabase';

/** Same metadata/storage contract as HenSense Mobile. The bucket is private. */
const BUCKET = 'hensense-avatars';
const LEGACY_AVATAR = (id: string) => `poultry-monitor-avatar-${id}`;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function avatarPathFor(userId: string, type: string) {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 12)}.${ext}`;
}

/** Fetches fresh user metadata, rather than relying on an old tab's cached session. */
export async function getRemoteProfile(): Promise<{
  displayName: string; avatarUrl: string | null; avatarPath: string | null;
}> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Please sign in again.');
  const displayName = typeof user.user_metadata?.display_name === 'string' && user.user_metadata.display_name.trim()
    ? user.user_metadata.display_name.trim()
    : user.email?.split('@')[0] || 'Account';
  const avatarPath = typeof user.user_metadata?.avatar_path === 'string' &&
    user.user_metadata.avatar_path.startsWith(`${user.id}/`)
    ? user.user_metadata.avatar_path : null;
  let avatarUrl: string | null = null;
  if (avatarPath) {
    const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(avatarPath, 3600);
    if (signedError) throw signedError;
    avatarUrl = data.signedUrl;
  }
  return { displayName, avatarUrl, avatarPath };
}

/** Keeps an older browser-only avatar visible until the user chooses to sync it. */
export async function getProfileAvatar(userId: string): Promise<string | null> {
  const remote = await getRemoteProfile();
  if (remote.avatarUrl) return remote.avatarUrl;
  return localStorage.getItem(LEGACY_AVATAR(userId));
}

/** Upload first; only publish the path after storage confirms success. */
export async function updateProfileAvatar(userId: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Please choose a photo smaller than 2 MB.');
  const path = avatarPathFor(userId, file.type);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type, upsert: false, cacheControl: '3600',
  });
  if (uploadError) throw uploadError;
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user || user.id !== userId) throw new Error('Your account changed; sign in again.');
    const oldPath: unknown = user.user_metadata?.avatar_path;
    const { error: metadataError } = await supabase.auth.updateUser({ data: { avatar_path: path } });
    if (metadataError) throw metadataError;
    const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signedError) throw signedError;
    // Only delete files belonging to this user, after metadata has been updated.
    if (typeof oldPath === 'string' && oldPath.startsWith(`${userId}/`) && oldPath !== path) {
      void supabase.storage.from(BUCKET).remove([oldPath]);
    }
    localStorage.removeItem(LEGACY_AVATAR(userId));
    return data.signedUrl;
  } catch (error) {
    // An unreferenced object must not be retained if metadata update fails.
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.user_metadata?.avatar_path !== path) void supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
}

export async function removeProfileAvatar(userId: string): Promise<void> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user || user.id !== userId) throw new Error('Please sign in again.');
  const oldPath: unknown = user.user_metadata?.avatar_path;
  const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_path: null } });
  if (updateError) throw updateError;
  if (typeof oldPath === 'string' && oldPath.startsWith(`${userId}/`)) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath]);
    if (removeError) console.warn('Avatar metadata removed; old file cleanup pending:', removeError.message);
  }
  localStorage.removeItem(LEGACY_AVATAR(userId));
}

export function getLegacyAvatarUrl(userId: string): string | null {
  return localStorage.getItem(LEGACY_AVATAR(userId));
}
export function hasLegacyAvatar(userId: string): boolean {
  return Boolean(localStorage.getItem(LEGACY_AVATAR(userId)));
}
export async function syncLegacyAvatar(userId: string): Promise<string> {
  const dataUrl = localStorage.getItem(LEGACY_AVATAR(userId));
  if (!dataUrl) throw new Error('There is no older browser photo to sync.');
  const blob = await fetch(dataUrl).then(r => r.blob());
  const mime = ALLOWED_TYPES.has(blob.type) ? blob.type : 'image/jpeg';
  const file = new File([blob], 'old-profile-photo.jpg', { type: mime });
  return updateProfileAvatar(userId, file);
}
