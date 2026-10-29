import { DEFAULT_TIME_ZONE, dayStart, nextDate, isStableDay, zonedDate, slotInstant } from './time-zone.ts';
export type Day = { date: string; slots: number[]; startAt?: number };
export type Availability = Record<string, number[]>;
export type EventData = { id: string; timeZone: string; title: string; description: string; dates: Day[]; duration: number; createdAt: number; expiresAt: number; status: 'open'|'closed'|'confirmed'; confirmed: string|null; revision: number };
export type Member = { id: string; nickname: string; role: 'owner'|'participant'; availability: Availability; version: number };
export type Snapshot = { event: EventData; members: Member[]; me: Member|null; nextParticipantNumber?: number };
export const DAY_MS = 86400000;
export const timeLabel = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2,'0')}:${slot % 2 ? '30' : '00'}`;
export const jstDate = (at = Date.now()) => new Date(at + 9 * 3600000).toISOString().slice(0,10);
export const dateEnd = (date: string, zone=DEFAULT_TIME_ZONE) => dayStart(nextDate(date),zone);
export const expiration = (dates: Day[], created: number, zone=DEFAULT_TIME_ZONE) => Math.min(created + 30 * DAY_MS, Math.max(...dates.map(d => slotInstant(d,48,zone))));
export function validateDays(input: unknown, created: number, now = Date.now(), zone=DEFAULT_TIME_ZONE): Day[] {
  if (!Array.isArray(input) || !input.length || input.length > 30) throw new Error('候補日を1〜30日選んでください。');
  const seen = new Set<string>();
  return input.map((d: Day) => {
    if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(Date.parse(d.date+'T00:00:00Z')) || new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date || d.date < zonedDate(now,zone) || seen.has(d.date)) throw new Error('候補日は今日から保存期限内の重複しない日付を選んでください。');
    if(!isStableDay(d.date,zone))throw new Error('候補日の時計が切り替わるため、この日付は選択できません。別の日付を選んでください。');
    if(dateEnd(d.date,zone)>created+30*DAY_MS)throw new Error('候補日は今日から保存期限内の重複しない日付を選んでください。');
    seen.add(d.date);
    if (!Array.isArray(d.slots) || !d.slots.length || d.slots.some(s => !Number.isInteger(s) || s < 0 || s > 47)) throw new Error('候補時間を30分単位で選んでください。');
    return {date:d.date,slots:[...new Set(d.slots)].sort((a,b)=>a-b)};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function validateAvailability(input: unknown, days: Day[]): Availability {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('回答を確認してください。');
  const result: Availability = {};
  for (const [date, slots] of Object.entries(input)) {
    const day=days.find(d=>d.date===date);
    if (!day || !Array.isArray(slots) || slots.some(s => !Number.isInteger(s) || !day.slots.includes(s))) throw new Error('候補外の時間帯が含まれています。最新の候補を確認してください。');
    result[date]=[...new Set(slots as number[])].sort((a,b)=>a-b);
  }
  return result;
}
export function recommendations(event: EventData, members: Member[]) {
  const participants=members.filter(m=>m.role==='participant');
  const length=event.duration/30;
  return event.dates.flatMap(day=>day.slots.filter(start=>Array.from({length},(_,i)=>start+i).every(s=>day.slots.includes(s))).map(start=>({date:day.date,start,end:start+length,count:participants.filter(m=>Array.from({length},(_,i)=>start+i).every(s=>m.availability[day.date]?.includes(s))).length}))).sort((a,b)=>b.count-a.count||a.date.localeCompare(b.date)||a.start-b.start);
}
export function canonicalNickname(input: unknown) {
  if(typeof input!=='string') throw new Error('ニックネームを入力してください。');
  const name=input.normalize('NFKC').trim();
  if (!name || name.length>24 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('ニックネームは1〜24文字で入力してください。');
  return name;
}
