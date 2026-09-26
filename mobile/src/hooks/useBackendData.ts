import { useAuth } from '../contexts/AuthContext';
import { userMessage } from '../lib/userMessages';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
// Cancel on blur/device change; never show a previous device's result while loading.
export function useBackendData<T>(loader: (id: string, signal: AbortSignal) => Promise<T>, id = '') {
  const {user}=useAuth(); const scope=`${user?.id ?? "signed-out"}:${process.env.EXPO_PUBLIC_DATA_SOURCE ?? "local"}:${id}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ id: string; data?: T; loading: boolean; error: string }>({ id, loading: true, error: '' });
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setState({ id:scope, loading: true, error: '' });
    loader(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ id:scope, data, loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ id:scope, loading: false, error: userMessage(error, 'Unable to load data. Please try again.') });
    });
    return () => controller.abort();
  }, [loader, id, scope, revision]));
  const retry = useCallback(() => setRevision(v => v + 1), []);
  return { ...(state.id === scope ? state : { loading: true, error: '', data: undefined }), retry };
}
