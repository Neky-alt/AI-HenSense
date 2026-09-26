import { supabase } from '../lib/supabase';

/** Prevent prototype AsyncStorage data from crossing Supabase account boundaries. */
export async function accountStorageKey(base: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.user?.id) throw new Error('Sign in before accessing account data.');
  return `${base}/account/${session.user.id}`;
}
