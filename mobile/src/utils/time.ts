/** UI-only time formatting. Source timestamps are ISO 8601; display uses device local time. */
export function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

export function formatElapsed(timestamp: string | null | undefined, now: Date = new Date()): string | null {
  if (!timestamp) return null;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  const seconds = Math.max(0, Math.floor((now.getTime() - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(new Date(time));
}

export function getGreeting(date: Date): string {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning!' : hour < 18 ? 'Good afternoon!' : 'Good evening!';
}

/** Prefer the ISO time; show a clear empty state instead of a frozen mock label. */
export function formatDeviceUpdate(timestamp: string | null | undefined, now: Date = new Date()): string {
  return formatElapsed(timestamp, now) ?? 'No detections';
}
