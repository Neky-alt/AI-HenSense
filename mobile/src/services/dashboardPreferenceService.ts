import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageKey } from './accountScope';
export interface DashboardPreferences { cage_device_ids: string[]; free_range_device_ids: string[] }
const KEY='@country-watch/dashboard-preferences-v2';
export async function getDashboardPreferences() {
  const raw=await AsyncStorage.getItem(await accountStorageKey(KEY));
  return raw?JSON.parse(raw) as DashboardPreferences:null;
}
export async function saveDashboardPreferences(value:DashboardPreferences) {
  await AsyncStorage.setItem(await accountStorageKey(KEY),JSON.stringify(value));
  return value;
}
