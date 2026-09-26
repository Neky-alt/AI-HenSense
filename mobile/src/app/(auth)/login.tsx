import { userMessage } from '../../lib/userMessages';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import AuthFrame, { authStyles } from '../../components/AuthFrame';
import { COLORS } from '../../constants/theme';
export default function Login() {
  const { signIn, recovering } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (recovering) router.replace('/reset-password'); }, [recovering]);
  const submit = async () => {
    if (pending) return;
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setError(''); setPending(true);
    try { await signIn(email.trim(), password); } catch (e) { setError(userMessage(e, 'Unable to sign in.')); }
    finally { setPending(false); }
  };
  return <AuthFrame eyebrow="WELCOME BACK" heading="Sign in to HenSense" description="Use the same account as HenSense Web.">
    <Text style={authStyles.label}>Email</Text>
    <TextInput style={authStyles.input} accessibilityLabel="Email" placeholder="name@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" value={email} onChangeText={setEmail}/>
    <Text style={authStyles.label}>Password</Text>
    <TextInput style={authStyles.input} accessibilityLabel="Password" placeholder="Your password" secureTextEntry textContentType="password" value={password} onChangeText={setPassword} onSubmitEditing={submit}/>
    <Pressable onPress={() => router.push('/forgot-password')} style={{ alignSelf: 'flex-end', paddingVertical: 10 }}><Text style={authStyles.link}>Forgot password?</Text></Pressable>
    {!!error && <Text style={authStyles.error}>{error}</Text>}
    <Pressable disabled={pending} onPress={submit} style={[authStyles.primary, pending && {opacity: 0.6}]}>{pending?<ActivityIndicator color="#fff"/>:<Text style={authStyles.primaryText}>Sign in</Text>}</Pressable>
    <View style={authStyles.footer}><Text style={authStyles.helper}>New to HenSense? </Text><Pressable onPress={() => router.push('/register')}><Text style={authStyles.link}>Create account</Text></Pressable></View>
  </AuthFrame>;
}
