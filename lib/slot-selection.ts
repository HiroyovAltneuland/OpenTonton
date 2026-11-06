/** Normalize selected half-hour slots into exclusive-end contiguous intervals. */
export function contiguousRanges(slots:number[]):[number,number][] {
 const ranges:[number,number][]=[];
 for(const slot of [...new Set(slots)].sort((a,b)=>a-b)) {
  const last=ranges[ranges.length-1];
  if(last&&last[1]===slot)last[1]=slot+1;else ranges.push([slot,slot+1]);
 }
 return ranges;
}
/** Paint relative to the gesture's initial selection, preserving unavailable gaps. */
export function paintSlots(before:number[],allowed:number[],start:number,end:number,selected:boolean):number[] {
 const next=new Set(before);const low=Math.min(start,end),high=Math.max(start,end);
 for(const slot of allowed)if(slot>=low&&slot<=high){if(selected)next.add(slot);else next.delete(slot);}
 return [...next].sort((a,b)=>a-b);
}
