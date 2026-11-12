'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Eraser, Undo2, X } from 'lucide-react';
import { useLanguage } from './language-provider';
import { useClock } from './time-display-provider';
import type { Availability, Day } from '../lib/scheduling';
import { contiguousRanges, paintSlots } from '../lib/slot-selection';

/** One shared scroll area keeps every date aligned, including on phones. */
export function SelectionTimeline({days,value,onChange,participant=false}:{days:Day[];value:Availability;onChange:(value:Availability)=>void;participant?:boolean}) {
 const {t,dateFormat}=useLanguage();const clock=useClock();
 const scroller=useRef<HTMLDivElement>(null);const dialog=useRef<HTMLDialogElement>(null);
 const [scrollEdges,setScrollEdges]=useState({atStart:true,atEnd:true});
 const [details,setDetails]=useState<string|null>(null);const [history,setHistory]=useState<Record<string,(number[]|undefined)[]>>({});
 const latest=useRef(value);
 useEffect(()=>{
  const before=latest.current;
  setHistory(h=>Object.fromEntries(days.map(day=>{
   const changed=JSON.stringify(before[day.date])!==JSON.stringify(value[day.date]);
   return [day.date,changed&&Object.hasOwn(before,day.date)?[...(h[day.date]||[]).slice(-19),before[day.date]]:h[day.date]||[]];
  })));
  latest.current=value;
 },[value]);
 const drag=useRef<{pointer:number;date:string;start:number;last:number;selected:boolean;before:Availability;moved:boolean}|null>(null);
 const suppressClick=useRef(false);
 const [showFullDay,setShowFullDay]=useState(false);
 const candidateSlots=days.flatMap(day=>day.slots);
 const firstCandidate=candidateSlots.length?Math.min(...candidateSlots):0;
 const lastCandidate=candidateSlots.length?Math.max(...candidateSlots)+1:48;
 const candidateSet=new Set(candidateSlots);
 const gaps=new Map<number,number>();
 if(participant){
  for(let slot=firstCandidate;slot<lastCandidate;){
   if(candidateSet.has(slot)){slot++;continue;}
   const gapStart=slot;
   while(slot<lastCandidate&&!candidateSet.has(slot))slot++;
   if(slot-gapStart>=16)gaps.set(gapStart,slot);
  }
 }
 const canCompact=participant&&(firstCandidate>0||lastCandidate<48||gaps.size>0);
 const compact=canCompact&&!showFullDay;
 const start=compact?firstCandidate:0;
 const finish=compact?lastCandidate:48;
 const columns:{start:number;end:number;gap:boolean}[]=[];
 for(let slot=start;slot<finish;){
  const gapEnd=compact?gaps.get(slot):undefined;
  columns.push({start:slot,end:gapEnd??slot+1,gap:gapEnd!==undefined});
  slot=gapEnd??slot+1;
 }
 const ticks=columns.filter((column,index)=>column.gap||column.start%2===0||index===0||columns[index-1].gap);
 const slotCount=columns.filter(column=>!column.gap).length;
 const gapCount=columns.length-slotCount;
 const columnsWidth=`calc(var(--selection-slot)*${slotCount} + var(--selection-gap)*${gapCount})`;
 const timeWidth=compact?`max(104px, ${columnsWidth})`:columnsWidth;
 const signature=days.map(d=>d.date).join(',');
 useEffect(()=>{const el=scroller.current;if(!el)return;if(compact){el.scrollLeft=0;return;}const first=Math.min(...days.flatMap(d=>value[d.date]?.length?value[d.date]:d.slots));const slot=el.querySelector<HTMLElement>('.selection-slot');if(slot&&Number.isFinite(first))el.scrollLeft=Math.max(0,first-2)*slot.getBoundingClientRect().width;},[signature,compact,start,finish]); // Do not jump while painting or changing display zone.
 useEffect(()=>{
  const el=scroller.current;
  if(!el)return;
  function updateEdges(){
   if(!el)return;
   const {scrollLeft,scrollWidth,clientWidth}=el;
   // The scroll position can be fractional, while the widths are rounded.
   const atStart=scrollLeft<=1;
   const atEnd=scrollWidth-clientWidth-scrollLeft<=1;
   setScrollEdges(previous=>previous.atStart===atStart&&previous.atEnd===atEnd
    ?previous
    :{atStart,atEnd});
  }
  const observer=new ResizeObserver(updateEdges);
  observer.observe(el);
  const table=el.querySelector('.selection-table');
  if(table)observer.observe(table);
  el.addEventListener('scroll',updateEdges,{passive:true});
  updateEdges();
  return ()=>{
   observer.disconnect();
   el.removeEventListener('scroll',updateEdges);
  };
 },[]);
 useEffect(()=>{if(details)dialog.current?.showModal();},[details]);
 function remember(date:string,before:Availability){setHistory(h=>({...h,[date]:[...(h[date]||[]).slice(-19),before[date]]}));}
 function change(date:string,slots:number[]|undefined){const next={...latest.current};if(slots===undefined)delete next[date];else next[date]=slots;latest.current=next;onChange(next);}
 function down(e:PointerEvent<HTMLButtonElement>,day:Day,slot:number){if(e.button!==0)return;suppressClick.current=false;drag.current={pointer:e.pointerId,date:day.date,start:slot,last:slot,selected:!value[day.date]?.includes(slot),before:value,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}
 function move(e:PointerEvent<HTMLButtonElement>){const d=drag.current;if(!d||d.pointer!==e.pointerId)return;const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-selection-slot]');if(!cell||cell.dataset.date!==d.date)return;const s=Number(cell.dataset.selectionSlot);if(s===d.last)return;const day=days.find(day=>day.date===d.date)!;if(!d.moved){remember(d.date,d.before);d.moved=true;}d.last=s;change(d.date,paintSlots(d.before[d.date]||[],day.slots,d.start,s,d.selected));}
 function end(e:PointerEvent<HTMLButtonElement>,cancel=false){const d=drag.current;if(!d||d.pointer!==e.pointerId)return;if(d.moved){suppressClick.current=true;if(cancel){onChange(d.before);latest.current=d.before;setHistory(h=>({...h,[d.date]:(h[d.date]||[]).slice(0,-1)}));}}drag.current=null;}
 return <div className={'selection-editor'+(participant?' participant-selection':'')+(compact?' compact-selection':'')}>
 <p className="field-hint">{t("タップで選択・解除。なぞってまとめて変更できます。横にスクロールすると別の時間が見られます。")}</p>
 <div className="selection-navigation">
  <button type="button" className="secondary" aria-label={t("早い時間へ")} title={t("早い時間へ")} disabled={scrollEdges.atStart} onClick={()=>scroller.current?.scrollBy({left:-228,behavior:'smooth'})}>
   <ChevronLeft size={24} aria-hidden="true"/>
  </button>
  {canCompact&&<button type="button" className="secondary selection-view-toggle" onClick={()=>setShowFullDay(value=>!value)}>{t(showFullDay?"候補範囲を表示":"24時間表示")}</button>}
  <button type="button" className="secondary" aria-label={t("遅い時間へ")} title={t("遅い時間へ")} disabled={scrollEdges.atEnd} onClick={()=>scroller.current?.scrollBy({left:228,behavior:'smooth'})}>
   <ChevronRight size={24} aria-hidden="true"/>
  </button>
 </div>
 <div className="selection-scroller" ref={scroller}><table className="selection-table" style={{width:`calc(var(--selection-date) + ${timeWidth})`}}><caption className="sr-only">{t("30分単位の時間選択")}</caption><colgroup><col style={{width:"var(--selection-date)"}}/><col style={{width:timeWidth}}/></colgroup><tbody>{days.map(day=>{
 const slots=value[day.date]||[];const ranges=contiguousRanges(slots);const label=dateFormat(day.date,{month:'numeric',day:'numeric',weekday:'short'});
 return <tr key={day.date}><th scope="row" className="selection-date"><strong>{label}</strong><div className="selection-tools"><button type="button" title={t("この日の選択を解除")} aria-label={label+' '+t("この日の選択を解除")} disabled={!slots.length} onClick={()=>{remember(day.date,value);change(day.date,[]);}}><Eraser size={19}/></button><button type="button" title={t("この日の変更を戻す")} aria-label={label+' '+t("この日の変更を戻す")} disabled={!history[day.date]?.length} onClick={()=>{const h=history[day.date];change(day.date,h[h.length-1]);setHistory(all=>({...all,[day.date]:h.slice(0,-1)}));}}><Undo2 size={19}/></button></div><button type="button" className="selection-summary" disabled={!ranges.length} aria-label={label+' '+t("選択時間の詳細")} onClick={()=>setDetails(day.date)}>{ranges.length>1?t("{0}区間",[ranges.length]):ranges.length?clock.time(day.date,ranges[0][0])+'–'+clock.time(day.date,ranges[0][1]):t("未選択")}</button>{participant&&<label className="selection-unavailable"><input type="checkbox" checked={Object.hasOwn(value,day.date)&&!slots.length} onChange={e=>{remember(day.date,value);change(day.date,e.target.checked?[]:undefined);}}/>{t("参加不可")}</label>}</th><td>{compact&&<div className="selection-window">{clock.time(day.date,start)}–{finish===48&&clock.displayZone===clock.eventZone?"24:00":clock.time(day.date,finish)}</div>}<div className="selection-hours">{ticks.map(({start:slot,end,gap},index)=>gap
  ? <span key={slot} className="selection-gap-heading" title={clock.range(day.date,slot,end)}><strong>{t("候補なし")}</strong><small>{clock.time(day.date,slot)}–{clock.time(day.date,end)}</small></span>
  : <span key={slot} style={{width:`calc(var(--selection-slot)*${(ticks[index+1]?.start??finish)-slot})`}} title={clock.full(day.date,slot)}>{clock.time(day.date,slot)}{clock.displayZone!==clock.eventZone&&(index===0||ticks[index-1].gap||clock.header(day.date,slot)!==clock.header(day.date,ticks[index-1].start))&&<small>{clock.header(day.date,slot)}</small>}</span>)}</div><div className="selection-band">{columns.map(({start:s,end:columnEnd,gap})=>gap?<span key={s} className="selection-gap-band" data-gap-start={s} data-gap-end={columnEnd} aria-hidden="true"/>:<button type="button" key={s} data-selection-slot={s} data-date={day.date} className={'selection-slot'+(slots.includes(s)?' selected':'')+(!day.slots.includes(s)?' outside':'')} disabled={!day.slots.includes(s)} aria-label={clock.range(day.date,s,s+1)} aria-pressed={slots.includes(s)} onPointerDown={e=>down(e,day,s)} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}remember(day.date,value);change(day.date,paintSlots(slots,day.slots,s,s,!slots.includes(s)));}}/> )}</div></td></tr>;
 })}</tbody></table></div>
 <p className="field-hint">{participant?t("緑のバーが参加できる時間、薄い青が候補時間です。"):t("青いバーが候補時間です。")} {clock.displayZone}</p>
 {details&&<dialog className="modal selection-details" ref={dialog} onCancel={()=>setDetails(null)} onClick={e=>{if(e.target===e.currentTarget)setDetails(null);}}><div className="modal-head"><h2>{dateFormat(details)} {t("選択時間の詳細")}</h2><button type="button" className="icon-btn" aria-label={t("閉じる")} onClick={()=>setDetails(null)}><X size={20}/></button></div><ul>{contiguousRanges(value[details]||[]).map(([start,end])=><li key={start}>{clock.range(details,start,end)}</li>)}</ul></dialog>}
 </div>;
}
