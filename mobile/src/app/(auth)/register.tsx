import { userMessage } from '../../lib/userMessages';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import AuthFrame, { authStyles } from '../../components/AuthFrame';
export default function Register() {
 const { signUp } = useAuth();
 const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState('');
 const [pending,setPending]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');
 const submit=async()=>{if(pending)return;setError('');setMessage('');if(!email.trim()||!email.includes('@')){setError('Enter a valid email.');return;}if(password.length<6){setError('Password must have at least 6 characters.');return;}if(password!==confirm){setError('Passwords do not match.');return;}setPending(true);try{const needsConfirmation=await signUp(email.trim(),password);setMessage(needsConfirmation?'Check your email to confirm the account, then sign in.':'Account created. You are now signed in.');}catch(e){setError(userMessage(e, 'Unable to create account.'));}finally{setPending(false);}};
 return <AuthFrame eyebrow="CREATE YOUR ACCOUNT" heading="Join HenSense" description="Use one account on Web and Mobile.">
 <Text style={authStyles.label}>Email</Text><TextInput style={authStyles.input} value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoCapitalize="none" placeholder="name@example.com" />
 <Text style={authStyles.label}>Password</Text><TextInput style={authStyles.input} value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" placeholder="At least 6 characters" />
 <Text style={authStyles.label}>Confirm password</Text><TextInput style={authStyles.input} value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" placeholder="Confirm password" onSubmitEditing={submit} />
 {!!error&&<Text style={authStyles.error}>{error}</Text>}{!!message&&<Text style={authStyles.success}>{message}</Text>}
 <Pressable disabled={pending} onPress={submit} style={[authStyles.primary,pending&&{opacity:0.6}]}>{pending?<ActivityIndicator color="#fff"/>:<Text style={authStyles.primaryText}>Create account</Text>}</Pressable>
 <View style={authStyles.footer}><Text style={authStyles.helper}>Already have an account? </Text><Pressable onPress={()=>router.replace('/login')}><Text style={authStyles.link}>Sign in</Text></Pressable></View>
 </AuthFrame>;
}
