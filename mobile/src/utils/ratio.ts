export function formatRatio(value: number | null | undefined) {
  if (value == null) return '--';
  return `${Math.round(value * 100)}%`;
}
