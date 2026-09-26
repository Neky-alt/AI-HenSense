export interface DashboardPreferences {
  cage_device_ids: string[];
  free_range_device_ids: string[];
}

const STORAGE_PREFIX = "poultry-monitor-dashboard-preferences-v1";

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function normaliseIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export async function getDashboardPreferences(
  userId: string
): Promise<DashboardPreferences | null> {
  try {
    const storedValue = localStorage.getItem(getStorageKey(userId));

    if (!storedValue) {
      return null;
    }

    const parsed = JSON.parse(storedValue) as Partial<DashboardPreferences>;

    return {
      cage_device_ids: normaliseIds(parsed.cage_device_ids).slice(0, 2),
      free_range_device_ids: normaliseIds(parsed.free_range_device_ids).slice(0, 2),
    };
  } catch {
    localStorage.removeItem(getStorageKey(userId));
    return null;
  }
}

export async function updateDashboardPreferences(
  userId: string,
  preferences: DashboardPreferences
): Promise<DashboardPreferences> {
  const normalised: DashboardPreferences = {
    cage_device_ids: normaliseIds(preferences.cage_device_ids).slice(0, 2),
    free_range_device_ids: normaliseIds(preferences.free_range_device_ids).slice(0, 2),
  };

  localStorage.setItem(getStorageKey(userId), JSON.stringify(normalised));
  return normalised;
}

export async function resetDashboardPreferences(userId: string): Promise<void> {
  localStorage.removeItem(getStorageKey(userId));
}
