import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {latestCandidateDate,isSelectableCandidateDate,validateDays,expiration,recommendations} from '../lib/scheduling.ts';
import {dayStart,nextDate} from '../lib/time-zone.ts';
import {eventCsv} from '../lib/event-csv.ts';

test('three calendar months include the boundary date and clamp month ends',()=>{
 for(const [input,expected] of [['2026-11-02','2027-02-02'],['2026-11-30','2027-02-28'],['2027-11-30','2028-02-29'],['2026-01-31','2026-04-30'],['2026-08-31','2026-11-30']]){
  const created=dayStart(input,'Asia/Tokyo')+12*3600000;
  assert.equal(latestCandidateDate(created),expected);
  assert.equal(isSelectableCandidateDate(expected,created),true);
  const days=validateDays([{date:expected,slots:[46,47]}],created,created);
  assert.equal(expiration(days,created),dayStart(nextDate(expected),'Asia/Tokyo'));
  assert.equal(isSelectableCandidateDate(nextDate(expected),created),false);
  assert.throws(()=>validateDays([{date:nextDate(expected),slots:[18]}],created,created));
 }
});
test('horizon uses the event civil date across UTC midnight and DST',()=>{
 const created=Date.parse('2026-11-02T01:00:00Z');
 assert.equal(latestCandidateDate(created,'Asia/Tokyo'),'2027-02-02');
 assert.equal(latestCandidateDate(created,'America/Los_Angeles'),'2027-02-01');
 assert.equal(latestCandidateDate(created,'Pacific/Kiritimati'),'2027-02-02');
 const spring=Date.parse('2027-01-01T10:00:00Z');
 assert.equal(isSelectableCandidateDate('2027-03-14',spring,spring,'America/New_York'),false);
 assert.throws(()=>validateDays([{date:'2027-03-14',slots:[18]}],spring,spring,'America/New_York'),/時計が切り替わる/);
 assert.equal(isSelectableCandidateDate('2027-03-15',spring,spring,'America/New_York'),true);
 assert.equal(expiration([{date:'2027-03-15',slots:[18]}],spring,'America/New_York'),Date.parse('2027-03-16T04:00:00Z'));
});
test('a DST change at the horizon does not reject an earlier valid candidate',()=>{
 const created=Date.parse('2026-12-14T12:00:00Z');
 assert.equal(latestCandidateDate(created,'America/New_York'),'2027-03-14');
 assert.equal(isSelectableCandidateDate('2027-03-14',created,created,'America/New_York'),false);
 assert.equal(expiration([{date:'2027-03-13',slots:[18]}],created,'America/New_York'),Date.parse('2027-03-14T05:00:00Z'));
});
test('30 dates remain the limit; worst-case answers, recommendations and CSV preserve all slots',()=>{
 const created=Date.parse('2026-11-02T01:00:00Z');
 const dates=Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,10,3+i)).toISOString().slice(0,10),slots:Array.from({length:48},(_,s)=>s)}));
 assert.equal(validateDays(dates,created,created).length,30);
 assert.throws(()=>validateDays([...dates,{date:'2026-12-03',slots:[18]}],created,created),/1〜30/);
 const availability=Object.fromEntries(dates.map(d=>[d.date,d.slots]));
 const members=Array.from({length:100},(_,i)=>({nickname:'test'+i,role:'participant',availability}));
 const event={dates,timeZone:'Asia/Tokyo',duration:120};
 const start=performance.now();const best=recommendations(event,members);const elapsed=performance.now()-start;
 assert.equal(best.length,30*45);assert(best.every(r=>r.count===100));
 const csv=eventCsv(event,members,'en','America/New_York');
 assert.equal(csv.split('\r\n').length,30*48*100+1);
 console.log(`100 participants / 30 dates / 48 slots: recommendations ${elapsed.toFixed(1)}ms; CSV ${Buffer.byteLength(csv)} bytes`);
});
