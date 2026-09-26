/**
 * BE-04 cloud read adapter. Explicitly opt in via VITE_DATA_SOURCE=cloud or
 * EXPO_PUBLIC_DATA_SOURCE=cloud; ordinary LAN traffic remains unchanged.
 * Every Supabase query runs with the signed-in user's session and existing RLS.
 * There is deliberately no service_role key in client code.
 */
import { supabase } from '../lib/supabase';

type Row = Record<string, any>;
const BUCKET = 'detection-images';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MINUTES = 15;

function client() {
  if (!supabase) throw new Error('Configure your Supabase public URL and publishable key.');
  return supabase;
}
async function ownedFarmIds(): Promise<string[]> {
  const db = client();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) throw new Error('Sign in to view cloud monitoring data.');
  const { data, error } = await db.from('farms').select('farm_id').eq('user_id', user.id).limit(100);
  if (error) throw new Error('Could not load your farms from Supabase.');
  return (data || []).map(f => f.farm_id);
}
async function ownedDevices(): Promise<Row[]> {
  const farms = await ownedFarmIds();
  if (!farms.length) return [];
  const { data, error } = await client().from('devices')
    .select('device_id,farm_id,device_code,device_name,farming_type,last_seen_at,is_active')
    .in('farm_id',farms).eq('is_active',true).order('device_code').limit(200);
  if (error) throw new Error('Could not load your cloud devices.');
  return data || [];
}
function deviceStatus(row: Row) {
  if (!row.is_active || !row.last_seen_at) return 'offline';
  const age = Date.now() - Date.parse(row.last_seen_at);
  return Number.isFinite(age) && age >= 0 && age <= TIMEOUT_MINUTES * 60000 ? 'online' : 'offline';
}
async function sign(key: string | null, device: Row, detection: Row): Promise<string | null> {
  if (!key || detection.image_deleted_at || detection.deleted_at) return null;
  const prefix = `farms/${device.farm_id}/devices/${device.device_id}/detections/${detection.detection_id}/`;
  if (!key.startsWith(prefix)) throw new Error('Unexpected cloud media path.');
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(key,600);
  if (error || !data?.signedUrl) throw new Error('Unable to access private detection image.');
  return data.signedUrl;
}
async function presentDetection(raw: Row, device: Row): Promise<Row> {
  // Cloud-only object paths are never interpreted as local HTTP image routes.
  const [original,annotated] = await Promise.all([
    sign(raw.image_url,device,raw),sign(raw.annotated_image_path,device,raw),
  ]);
  return {
    ...raw, image_path:null, image_url:original,
    annotated_image_url:annotated, annotated_image_path:null,
  };
}
async function historyRaw(deviceId: string, limit = 500): Promise<Row[]> {
  const { data, error } = await client().from('detections').select('*')
    .eq('device_id',deviceId).is('deleted_at',null)
    .order('detected_at',{ascending:false}).order('created_at',{ascending:false}).limit(limit);
  if (error) throw new Error('Could not load synced detection history.');
  return data || [];
}
async function deviceView(raw: Row): Promise<Row> {
  // Query the formal snapshot directly: arbitrary numbers of newer manual
  // single-frame results must never hide an older Free-range snapshot.
  let query=client().from('detections').select('*')
    .eq('device_id',raw.device_id).is('deleted_at',null);
  if(raw.farming_type==='free_range') query=query.eq('trigger_type','free_range_snapshot');
  const {data,error}=await query.order('detected_at',{ascending:false})
    .order('created_at',{ascending:false}).limit(1);
  if(error)throw new Error('Unable to load latest synced detection.');
  const latest=data?.[0];
  return { ...raw, device_status: deviceStatus(raw),
    latest_detection:latest ? await presentDetection(latest,raw) : null };
}
async function cloudDevices(): Promise<Row[]> {
  const devices = await ownedDevices();
  return Promise.all(devices.map(deviceView));
}
async function cloudDevice(id: string): Promise<Row> {
  if (!uuid.test(id)) throw new Error('Invalid device ID.');
  const devices=await ownedDevices();
  const device=devices.find(d=>d.device_id===id);
  if (!device) throw new Error('Device not found for signed-in user.');
  return device;
}
async function cloudHistory(id:string):Promise<Row[]> {
  const device=await cloudDevice(id);
  return Promise.all((await historyRaw(id)).map(d=>presentDetection(d,device)));
}
async function cloudAlerts(id:string):Promise<Row[]> {
  await cloudDevice(id);
  const {data,error}=await client().from('alerts')
    .select('alert_id,device_id,alert_type,alert_status,message,created_at,resolved_at')
    .eq('device_id',id).order('created_at',{ascending:false}).limit(500);
  if(error)throw new Error('Unable to load cloud alerts.');
  return data||[];
}
async function cloudSummary():Promise<Row> {
  // Mirrors the local Backend's established read-only aggregation over its
  // already-computed, synced Detection counts and monitoring_status fields.
  const devices=await cloudDevices();
  const caged=devices.filter(d=>d.farming_type==='caged');
  const free=devices.filter(d=>d.farming_type==='free_range');
  const active=(d:Row)=>d.device_status!=='offline';
  const base=(list:Row[])=>({device_count:list.length,
    normal_device_count:list.filter(d=>active(d)&&d.latest_detection?.monitoring_status==='normal').length,
    warning_device_count:list.filter(d=>active(d)&&d.latest_detection?.monitoring_status==='warning').length,
    offline_device_count:list.filter(d=>!active(d)).length});
  const valid=caged.filter(d=>active(d)&&d.latest_detection?.total_count>0);
  const totals=valid.reduce((sum,d)=>sum+d.latest_detection.total_count,0);
  return {
    cage:{...base(caged),overall_low_ratio:totals?valid.reduce((sum,d)=>sum+d.latest_detection.low_count,0)/totals:null},
    free_range:{...base(free),latest_low_count:free.reduce((sum,d)=>sum+(d.latest_detection?.low_count??0),0)},
  };
}
export async function be04CloudGet<T>(path:string,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)throw new Error('Request cancelled');
  const initial = await client().auth.getUser();
  const initialUserId=initial.data.user?.id;
  if(initial.error||!initialUserId)throw new Error('Sign in to view cloud monitoring data.');
  let result:unknown;
  if(path==='/devices') result=await cloudDevices();
  else if(path==='/dashboard/summary') result=await cloudSummary();
  else {
    const match=path.match(/^\/devices\/([^/]+)(?:\/(.*))?$/);
    if(!match) throw new Error(`Cloud read mode does not support ${path}.`);
    const id=decodeURIComponent(match[1]);
    if(!uuid.test(id))throw new Error('Invalid device ID.');
    const suffix=match[2]||'';
    if(suffix==='') result=await deviceView(await cloudDevice(id));
    else if(suffix==='detections') result=await cloudHistory(id);
    else if(suffix==='detections/latest') result=(await deviceView(await cloudDevice(id))).latest_detection;
    else if(suffix==='alerts') result=await cloudAlerts(id);
    else throw new Error(`Cloud read mode does not support ${path}.`);
  }
  if(signal?.aborted)throw new Error('Request cancelled');
  const current=await client().auth.getUser();
  if(current.error||current.data.user?.id!==initialUserId)
    throw new Error('Account changed. Please reload monitoring data.');
  return result as T;
}
