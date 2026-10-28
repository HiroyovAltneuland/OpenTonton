import { DEFAULT_TIME_ZONE, offsetLabel, slotInstant, zonedParts, type AnchoredDay } from './time-zone.ts';
import { formatDate, formatStamp, type Language } from './i18n.ts';
import type { Day } from './scheduling.ts';
export function makeClock(eventZone=DEFAULT_TIME_ZONE, displayZone=eventZone, days:Day[]=[], language:Language='ja') {
  const locale=language==='ja'?'ja-JP':'en-US';
  const dateFormat=new Intl.DateTimeFormat(locale,{timeZone:displayZone,year:'numeric',month:'short',day:'numeric',weekday:'short'});
  const shortDate=new Intl.DateTimeFormat(locale,{timeZone:displayZone,month:'short',day:'numeric',weekday:'short'});
  const memo=new Map<string,number>();
  const point=(date:string,slot:number)=>{const key=date+'@'+slot;let at=memo.get(key);if(at===undefined){at=slotInstant(days.find(d=>d.date===date)||date,slot,eventZone);memo.set(key,at);}return at;};
  const full=(date:string,slot:number)=>{const at=point(date,slot);return `${dateFormat.format(at)} ${zonedParts(at,displayZone).time} ${offsetLabel(at,displayZone)}`;};
  const time=(date:string,slot:number)=>zonedParts(point(date,slot),displayZone).time;
  return {
    eventZone,displayZone,point,full,time,
    chip:(date:string,slot:number)=>eventZone===displayZone?time(date,slot):`${shortDate.format(point(date,slot))} ${time(date,slot)} ${offsetLabel(point(date,slot),displayZone)}`,
    header:(date:string,slot:number)=>`${zonedParts(point(date,slot),displayZone).date.slice(5)} ${offsetLabel(point(date,slot),displayZone)}`,
    month:(date:string,slot:number)=>new Intl.DateTimeFormat(locale,{timeZone:displayZone,month:'short'}).format(point(date,slot)),
    dayNumber:(date:string,slot:number)=>zonedParts(point(date,slot),displayZone).day,
    date:(date:string,slot:number)=>dateFormat.format(point(date,slot)),
    day:(day:Day)=>{
      if(displayZone===eventZone)return formatDate(day.date,language);
      const a=point(day.date,Math.min(...day.slots)),b=point(day.date,Math.max(...day.slots)+1)-1;
      return dateFormat.format(a)+(zonedParts(a,displayZone).date===zonedParts(b,displayZone).date?'':' – '+dateFormat.format(b));
    },
    range:(date:string,start:number,end:number)=>full(date,start)+' – '+full(date,end),
    stamp:(at:number)=>`${formatStamp(at,language,displayZone)} ${offsetLabel(at,displayZone)} · ${displayZone}`,
  };
}
export type EventClock = ReturnType<typeof makeClock>;
