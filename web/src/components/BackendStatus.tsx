interface Props { loading: boolean; error?: string; retry: () => void; }

export default function BackendStatus({ loading, error, retry }: Props) {
  if (error) return <div className="dd-empty-note" role="alert">Unable to load Backend data: {error} <button className="text-action-button" onClick={retry}>Retry</button></div>;
  if (loading) return <p className="dd-empty-note" role="status">Loading Backend data…</p>;
  return null;
}
