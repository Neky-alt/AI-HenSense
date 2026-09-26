import { Redirect } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
export default function InitialRoute() {
  const { session, recovering } = useAuth();
  return <Redirect href={recovering ? '/reset-password' : session ? '/(tabs)' : '/login'} />;
}
