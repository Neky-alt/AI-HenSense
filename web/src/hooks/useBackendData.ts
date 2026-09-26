import { useAuth } from '../contexts/AuthContext';
import { userMessage } from '../lib/userMessages';
import { useEffect, useState } from "react";

export function useBackendData<T>(load: (id: string, signal: AbortSignal) => Promise<T>, id = "") {
  const {user}=useAuth(); const scope=`${user?.id ?? "signed-out"}:${import.meta.env.VITE_DATA_SOURCE ?? "local"}:${id}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ id: string; revision: number; data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    load(id, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ id:scope, revision, data }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ id:scope, revision, error: userMessage(error, 'Unable to load data. Please try again.') });
      },
    );
    return () => controller.abort();
  }, [load, id, scope, revision]);

  // Do not render a previous device's data while a new request is pending.
  const current = result?.id === scope && result.revision === revision ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    retry: () => setRevision((value) => value + 1),
  };
}
