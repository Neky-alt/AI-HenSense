import AsyncStorage from '@react-native-async-storage/async-storage';

/** Prototype-only profile storage; Supabase Auth remains a separate next phase. */
export interface LocalProfile {
  display_name: string;
  farm_name: string;
}

const STORAGE_KEY = '@country-watch/profile-v1';
const DEFAULT_PROFILE: LocalProfile = { display_name: 'Farm Owner', farm_name: 'My Farm' };

export async function getLocalProfile(): Promise<LocalProfile> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_PROFILE };
  try {
    const data: Partial<LocalProfile> = JSON.parse(raw);
    return {
      display_name: typeof data.display_name === 'string' && data.display_name.trim() ? data.display_name : DEFAULT_PROFILE.display_name,
      farm_name: typeof data.farm_name === 'string' && data.farm_name.trim() ? data.farm_name : DEFAULT_PROFILE.farm_name,
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export async function saveLocalProfile(profile: LocalProfile): Promise<void> {
  const display_name = profile.display_name.trim();
  const farm_name = profile.farm_name.trim();
  if (!display_name || !farm_name) throw new Error('Display name and farm name are required.');
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ display_name, farm_name }));
}
