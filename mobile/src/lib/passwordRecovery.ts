import { userMessage } from './userMessages';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

export const PASSWORD_RESET_REDIRECT = 'hensense://reset-password';
export type RecoveryState = { status: 'idle' | 'processing' | 'ready' | 'error'; error: string | null };
type Auth = Pick<SupabaseClient['auth'], 'setSession' | 'getSession' | 'updateUser' | 'signOut' | 'resetPasswordForEmail'>;
const invalidLink = 'This password reset link is invalid or expired. Please request a new email.';
const message = (error: unknown) => userMessage(error, invalidLink);

export function parseRecoveryUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'hensense:' || url.hostname !== 'reset-password' || (url.pathname && url.pathname !== '/')) return null;
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.slice(1)).forEach((value, key) => params.set(key, value));
  const error = params.get('error_description') || params.get('error') || params.get('error_code');
  if (error) return { error: invalidLink };
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (params.get('type') !== 'recovery' || !access_token || !refresh_token) return { error: invalidLink };
  return { tokens: { access_token, refresh_token } };
}

// Shared by initial-URL and live-URL delivery. Tokens remain in memory only.
export function createPasswordRecovery(auth: Auth, changed: (state: RecoveryState) => void) {
  let state: RecoveryState = { status: 'idle', error: null };
  let recoveryUserId: string | null = null;
  let version = 0;
  let submitting = false;
  let disposed = false;
  let queue = Promise.resolve();
  const seen = new Set<string>();
  const publish = (status: RecoveryState['status'], error: string | null = null) => {
    state = { status, error };
    if (!disposed) changed(state);
  };
  const reset = () => { version++; recoveryUserId = null; publish('idle'); };
  return {
    get state() { return state; },
    reset,
    dispose() { disposed = true; version++; recoveryUserId = null; seen.clear(); },
    fail(error: unknown) { version++; recoveryUserId = null; publish('error', message(error)); },
    onAuthEvent(event: string, session: Session | null) {
      if (disposed) return;
      if (event === 'SIGNED_OUT') { recoveryUserId = null; if (state.status === 'ready') publish('error', invalidLink); }
      if (event === 'PASSWORD_RECOVERY' && session && state.status === 'idle') {
        recoveryUserId = session.user.id;
        publish('ready');
      }
    },
    handleUrl(raw: string): Promise<void> {
      const parsed = parseRecoveryUrl(raw);
      if (!parsed || disposed || submitting) return Promise.resolve();
      if (seen.has(raw)) return queue;
      seen.add(raw);
      const current = ++version;
      recoveryUserId = null;
      publish('processing');
      queue = queue.then(async () => {
        if (disposed || current !== version) return;
        if ('error' in parsed) { publish('error', parsed.error); return; }
        try {
          const { data, error } = await auth.setSession(parsed.tokens);
          if (disposed || current !== version) return;
          if (error) throw error;
          if (!data.session) throw new Error(invalidLink);
          recoveryUserId = data.session.user.id;
          publish('ready');
        } catch (error) {
          if (!disposed && current === version) publish('error', message(error));
        }
      });
      return queue;
    },
    async sendEmail(email: string) {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_REDIRECT });
      if (error) throw error;
    },
    async updatePassword(password: string) {
      if (submitting || state.status !== 'ready' || !recoveryUserId) throw new Error('Open a valid password reset link and wait for verification before submitting.');
      submitting = true;
      try {
        const { data, error: sessionError } = await auth.getSession();
        if (sessionError) { publish('error', message(sessionError)); throw sessionError; }
        if (!data.session || data.session.user.id !== recoveryUserId || state.status !== 'ready') {
          publish('error', invalidLink);
          throw new Error(invalidLink);
        }
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
        // Keep auth routes accessible until local sign-out has completed.
        publish('processing');
        try {
          const { error: signOutError } = await auth.signOut({ scope: 'local' });
          if (signOutError) throw signOutError;
        } catch (error) {
          publish('error', 'Password updated, but sign out failed. Please sign out before signing in again.');
          throw error;
        }
        reset();
      } finally { submitting = false; }
    },
  };
}

// Subscribe before reading the launch URL so warm callbacks cannot be lost.
export function listenForPasswordRecovery(
  linking: {
    getInitialURL(): Promise<string | null>;
    addEventListener(type: 'url', listener: (event: { url: string }) => void): { remove(): void };
  },
  controller: Pick<ReturnType<typeof createPasswordRecovery>, 'handleUrl' | 'fail'>,
) {
  let active = true;
  let liveRecoveryReceived = false;
  const subscription = linking.addEventListener('url', ({ url }) => {
    if (!active || !parseRecoveryUrl(url)) return;
    liveRecoveryReceived = true;
    void controller.handleUrl(url);
  });
  const ready = linking.getInitialURL().then(url => {
    if (active && url && !liveRecoveryReceived) return controller.handleUrl(url);
  }).catch(error => { if (active) controller.fail(error); });
  return { ready, remove() { active = false; subscription.remove(); } };
}
