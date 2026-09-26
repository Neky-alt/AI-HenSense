import type { SupabaseClient } from '@supabase/supabase-js'
type Auth = SupabaseClient['auth']
export const recoverySuccess = 'If an account exists for this email, you will receive a password reset link.'
export function recoveryError(error: { status?: number; code?: string } | null) {
  if (error) console.warn('HenSense recovery error', {code:error.code,status:error.status})
  return error?.status === 429 || error?.code === 'over_email_send_rate_limit'
    ? 'Too many email requests. Please wait before trying again.'
    : 'Unable to send the reset email. Please try again later.'
}
// Subscribe before Supabase finishes processing the URL. A normal login session
// alone does not enable the password recovery form.
export function createWebRecovery(auth: Auth) {
  let userId: string | null = null
  const listeners = new Set<(ready: boolean) => void>()
  auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') userId = session?.user.id ?? null
    else if (event === 'SIGNED_OUT' || (userId && session?.user.id !== userId)) userId = null
    listeners.forEach(listener => listener(!!userId))
  })
  return {
    subscribe(listener: (ready: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async ready() {
      const { data, error } = await auth.getSession()
      return !error && !!userId && data.session?.user.id === userId
    },
    async update(password: string) {
      if (!await this.ready()) throw new Error('This reset link is invalid or expired. Please request a new email.')
      const { error } = await auth.updateUser({ password })
      if (error) throw error
      userId = null
      const { error: signOutError } = await auth.signOut({ scope: 'local' })
      if (signOutError) throw new Error('Password updated. Please sign out before signing in again.')
    },
  }
}
