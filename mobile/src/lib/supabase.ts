import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// Use the SAME public project URL and publishable/anon key as Web.
// Do not bundle your Supabase service_role key or the Web .env.local file.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
export const supabaseConfigured = Boolean(url && key && /^https:\/\//.test(url));
export const supabase = supabaseConfigured ? createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
}) : null;

if (supabase && Platform.OS !== 'web') {
  // Register once at module load, not every time a screen mounts.
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
