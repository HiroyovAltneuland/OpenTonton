export const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
export const HALF_HOUR_MS = 1800000;
const DAY = 86400000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const starts = new Map<string, number>();
const stable = new Map<string, boolean>();
function boundedSet<K,V>(map: Map<K,V>, key: K, value: V) {
  if(map.size >= 512) map.delete(map.keys().next().value!);
  map.set(key,value);
}
export function canonicalTimeZone(value: unknown = DEFAULT_TIME_ZONE): string {
  if(typeof value !== 'string' || value.length > 64 || !/^(UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) throw new Error('候補のタイムゾーンを選択してください。');
  try { return new Intl.DateTimeFormat('en-US',{timeZone:value}).resolvedOptions().timeZone; }
  catch { throw new Error('候補のタイムゾーンを選択してください。'); }
}
function formatter(zone: string) {
  let fmt=formatters.get(zone);
  if(!fmt) { fmt=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}); boundedSet(formatters,zone,fmt); }
  return fmt;
}
export function zonedParts(at: number, zone: string) {
  const p=Object.fromEntries(formatter(zone).formatToParts(at).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,year:Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour),minute:Number(p.minute),second:Number(p.second)};
}
export const zonedDate = (at=Date.now(),zone=DEFAULT_TIME_ZONE) => zonedParts(at,zone).date;
export function offsetMinutes(at: number, zone: string) {
  const p=zonedParts(at,zone);
  return (Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(at/1000)*1000)/60000;
}
export function offsetLabel(at: number, zone: string) {
  const n=offsetMinutes(at,zone),abs=Math.abs(n);
  return `UTC${n<0?'-':'+'}${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`;
}
export function nextDate(date: string) { return new Date(Date.parse(date+'T00:00:00Z')+DAY).toISOString().slice(0,10); }
export function dayStart(date: string, zone=DEFAULT_TIME_ZONE): number {
  const key=zone+'|'+date;const cached=starts.get(key);if(cached!==undefined)return cached;
  const target=Date.parse(date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==date)throw new Error('候補日は今日から保存期限内の重複しない日付を選んでください。');
  const offsets=new Set<number>();for(const delta of [-36,-12,0,12,36]) offsets.add(offsetMinutes(target+delta*3600000,zone));
  const matches=[...offsets].map(offset=>target-offset*60000).filter(at=>{const p=zonedParts(at,zone);return p.date===date&&p.time==='00:00'&&p.second===0;});
  if(matches.length!==1)throw new Error('候補日の時計が切り替わるため、この日付は選択できません。別の日付を選んでください。');
  boundedSet(starts,key,matches[0]);return matches[0];
}
export function isStableDay(date: string, zone=DEFAULT_TIME_ZONE): boolean {
  const key=zone+'|'+date;const cached=stable.get(key);if(cached!==undefined)return cached;
  let result=false;
  try {const start=dayStart(date,zone),end=dayStart(nextDate(date),zone);result=end-start===DAY&&offsetMinutes(start,zone)===offsetMinutes(end-1,zone);}catch { /* Impossible/ambiguous midnight or invalid civil date. */ }
  boundedSet(stable,key,result);return result;
}
export type AnchoredDay = {date:string; startAt?:number};
export function slotInstant(day: string | AnchoredDay, slot: number, zone=DEFAULT_TIME_ZONE): number {
  const date=typeof day==='string'?day:day.date;
  const start=typeof day==='object'&&Number.isFinite(day.startAt)?day.startAt!:dayStart(date,zone);
  return start+slot*HALF_HOUR_MS;
}
export function zonedIso(at: number, zone: string) {
  const p=zonedParts(at,zone);
  return `${p.date}T${p.time}:${String(p.second).padStart(2,'0')}${offsetLabel(at,zone).slice(3)}`;
}
export const COMMON_TIME_ZONES = [DEFAULT_TIME_ZONE,'UTC','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Kolkata','Asia/Kathmandu','Australia/Sydney','Pacific/Auckland','Europe/London','Europe/Paris','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Pacific/Honolulu'];
export function availableTimeZones(extra: string[] = []): string[] {
  let supported:string[]=[];try{supported=Intl.supportedValuesOf('timeZone');}catch{/* Common zones work on older browsers too. */}
  return [...new Set([...COMMON_TIME_ZONES,...extra,...supported])];
}
export function groupTimeZones(zones: string[], at: number) {
  const unique = [...new Set(zones.map(zone=>canonicalTimeZone(zone)))];
  const groups = new Map<number, {offset: number; label: string; zones: string[]}>();
  for (const zone of unique) {
    const offset = offsetMinutes(at, zone);
    if (!groups.has(offset)) groups.set(offset, {offset, label: offsetLabel(at, zone), zones: []});
    groups.get(offset)!.zones.push(zone);
  }
  return [...groups.values()].sort((a,b)=>b.offset-a.offset).map(group=>({...group,zones:group.zones.sort()}));
}
