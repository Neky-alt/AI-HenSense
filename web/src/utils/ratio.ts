export function ratioToPercent(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return null;
  }

  return ratio * 100;
}

export function formatRatio(
  ratio: number | null | undefined,
  maximumFractionDigits = 0
): string {
  const percentage = ratioToPercent(ratio);

  if (percentage === null) {
    return "--";
  }

  return `${percentage.toLocaleString(undefined, {
    maximumFractionDigits,
  })}%`;
}
