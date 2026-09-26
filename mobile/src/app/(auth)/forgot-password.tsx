import { userMessage } from '../../lib/userMessages';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import AuthFrame, { authStyles } from '../../components/AuthFrame';
export default function ForgotPassword() {
 const {sendPasswordReset}=useAuth();const[email,setEmail]=useState('');const[pending,setPending]=useState(false);const[error,setError]=useState('');const[message,setMessage]=useState('');
 const submit=async()=>{if(pending)return;if(!email.includes('@')){setError('Enter a valid email address.');return;}setError('');setPending(true);try{await sendPasswordReset(email.trim());setMessage('If this email is registered, a password reset link has been sent. Open the link on this phone.');}catch(e){setError(userMessage(e, 'Unable to send reset email.'));}finally{setPending(false);}};
 return <AuthFrame eyebrow="ACCOUNT RECOVERY" heading="Reset password" description="We will email you a recovery link."><Text style={authStyles.label}>Email</Text><TextInput style={authStyles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@example.com" />{!!error&&<Text style={authStyles.error}>{error}</Text>}{!!message&&<Text style={authStyles.success}>{message}</Text>}<Pressable disabled={pending} onPress={submit} style={authStyles.primary}>{pending?<ActivityIndicator color="#fff"/>:<Text style={authStyles.primaryText}>Send reset link</Text>}</Pressable><Pressable onPress={()=>router.replace('/login')} style={{alignSelf:'center',padding:16}}><Text style={authStyles.link}>Back to sign in</Text></Pressable></AuthFrame>;
}
