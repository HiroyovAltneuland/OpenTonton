export type Day = { date: string; slots: number[] };
export type Availability = Record<string, number[]>;
export type EventData = { id: string; title: string; description: string; dates: Day[]; duration: number; createdAt: number; expiresAt: number; status: 'open'|'closed'|'confirmed'; confirmed: string|null; revision: number };
export type Member = { id: string; nickname: string; role: 'owner'|'participant'; availability: Availability; version: number };
export type Snapshot = { event: EventData; members: Member[]; me: Member|null };
export const DAY_MS = 86400000;
export const timeLabel = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2,'0')}:${slot % 2 ? '30' : '00'}`;
export const jstDate = (at = Date.now()) => new Date(at + 9 * 3600000).toISOString().slice(0,10);
export const dateEnd = (date: string) => Date.parse(`${date}T00:00:00+09:00`) + DAY_MS;
export const expiration = (dates: Day[], created: number) => Math.min(created + 30 * DAY_MS, Math.max(...dates.map(d => dateEnd(d.date))));
export function validateDays(input: unknown, created: number, now = Date.now()): Day[] {
  if (!Array.isArray(input) || !input.length || input.length > 30) throw new Error('候補日を1〜30日選んでください。');
  const seen = new Set<string>();
  return input.map((d: Day) => {
    if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(dateEnd(d.date)) || jstDate(dateEnd(d.date)-1) !== d.date || d.date < jstDate(now) || dateEnd(d.date) > created + 30 * DAY_MS || seen.has(d.date)) throw new Error('候補日は今日から保存期限内の重複しない日付を選んでください。');
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
