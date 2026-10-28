import { csvCell } from './csv.ts';
import { translate, type Language } from './i18n.ts';
import { DEFAULT_TIME_ZONE, slotInstant, zonedIso } from './time-zone.ts';
import type { EventData, Member } from './scheduling.ts';
export function eventCsv(event: EventData, members: Member[], language: Language, displayZone=event.timeZone||DEFAULT_TIME_ZONE): string {
  const t=(s:string)=>translate(language,s);const zone=event.timeZone||DEFAULT_TIME_ZONE;
  const headers=['イベント日付','イベント開始','イベント終了','イベントのタイムゾーン','表示開始','表示終了','表示のタイムゾーン','開始（UTC）','終了（UTC）','ニックネーム','参加可否'];
  const rows=[headers.map(t),...event.dates.flatMap(day=>day.slots.flatMap(slot=>members.filter(m=>m.role==='participant').map(member=>{
    const start=slotInstant(day,slot,zone),end=start+1800000;
    return [day.date,zonedIso(start,zone),zonedIso(end,zone),zone,zonedIso(start,displayZone),zonedIso(end,displayZone),displayZone,new Date(start).toISOString(),new Date(end).toISOString(),member.nickname,member.availability[day.date]?.includes(slot)?'○':Object.hasOwn(member.availability,day.date)?'':t('未回答')];
  })))];
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
