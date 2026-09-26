import { userMessage } from '../../lib/userMessages';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import AuthFrame, { authStyles } from '../../components/AuthFrame';

export default function ResetPassword() {
  const { updatePassword, recovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ready = recovery.status === 'ready';
  const submit = async () => {
    if (pending || !ready) return;
    if (password.length < 6) { setError('Password must have at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError(''); setPending(true);
    try { await updatePassword(password); router.replace('/login'); }
    catch (e) { setError(userMessage(e, 'Unable to update password.')); }
    finally { setPending(false); }
  };
  return <AuthFrame eyebrow="ACCOUNT RECOVERY" heading="Choose a new password" description="Complete your password reset.">
    {recovery.status === 'processing' && <><ActivityIndicator /><Text style={authStyles.helper}>Verifying your recovery session…</Text></>}
    {recovery.status === 'idle' && <Text style={authStyles.error}>Open a valid reset link from your email before changing your password.</Text>}
    {!!recovery.error && <Text accessibilityRole="alert" style={authStyles.error}>{recovery.error}</Text>}
    <Text style={authStyles.label}>New password</Text>
    <TextInput style={authStyles.input} value={password} editable={ready && !pending} secureTextEntry onChangeText={setPassword} placeholder="At least 6 characters" />
    <Text style={authStyles.label}>Confirm password</Text>
    <TextInput style={authStyles.input} value={confirm} editable={ready && !pending} secureTextEntry onChangeText={setConfirm} placeholder="Confirm new password" />
    {!!error && <Text accessibilityRole="alert" style={authStyles.error}>{error}</Text>}
    <Pressable disabled={pending || !ready} onPress={submit} style={[authStyles.primary, (pending || !ready) && { opacity: 0.6 }]}>
      {pending ? <ActivityIndicator color="#fff" /> : <Text style={authStyles.primaryText}>Update password</Text>}
    </Pressable>
    <Pressable disabled={pending || recovery.status === 'processing'} onPress={() => router.replace('/forgot-password')} style={{ alignSelf: 'center', padding: 16 }}>
      <Text style={authStyles.link}>Send a new reset email</Text>
    </Pressable>
  </AuthFrame>;
}
