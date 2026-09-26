import { Fragment } from 'react';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { createPasswordRecovery, listenForPasswordRecovery, type RecoveryState } from '../lib/passwordRecovery';

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  recovering: boolean;
  recovery: RecoveryState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const client = () => {
  if (!supabase) throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  return supabase;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState<RecoveryState>({ status: 'idle', error: null });
  const recoveryController = useMemo(() => supabase ? createPasswordRecovery(supabase.auth, setRecovery) : null, []);
  const recovering = recovery.status !== 'idle';
  useEffect(() => {
    if (!supabase || !recoveryController) { setLoading(false); return; }
    let mounted = true;
    let authRevision = 0;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      authRevision++;
      if (mounted) { setSession(next); recoveryController.onAuthEvent(event, next); }
    });
    const listener = listenForPasswordRecovery(Linking, recoveryController);
    const revision = authRevision;
    const restore = supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.warn('Supabase session restore:', error.message);
      if (mounted && revision === authRevision) setSession(data.session);
    }).catch(() => { /* An invalid stored session must not prevent recovery. */ });
    void Promise.all([restore, listener.ready]).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; subscription.unsubscribe(); listener.remove(); };
  }, [recoveryController]);
  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null, session, loading, configured: supabaseConfigured, recovering, recovery,
    signIn: async (email, password) => { const { error } = await client().auth.signInWithPassword({ email, password }); if (error) throw error; },
    signUp: async (email, password) => {
      const { data, error } = await client().auth.signUp({ email, password });
      if (error) throw error;
      return !data.session; // true = email verification is required by the project configuration
    },
    signOut: async () => { const { error } = await client().auth.signOut(); if (error) throw error; recoveryController?.reset(); },
    sendPasswordReset: async email => { client(); await recoveryController!.sendEmail(email); },
    updatePassword: async password => { client(); await recoveryController!.updatePassword(password); setSession(null); },
  }), [session, loading, recovering, recovery, recoveryController]);
  return <AuthContext.Provider value={value}><Fragment key={session?.user.id ?? 'signed-out'}>{children}</Fragment></AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}
