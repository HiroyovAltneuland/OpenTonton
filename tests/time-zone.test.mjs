import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalTimeZone, dayStart, slotInstant, zonedDate, zonedParts, isStableDay, zonedIso} from '../lib/time-zone.ts';
import {validateDays, expiration, DAY_MS} from '../lib/scheduling.ts';
import {makeClock} from '../lib/time-display.ts';
import {eventCsv} from '../lib/event-csv.ts';
const created=Date.parse('2026-10-28T01:00:00Z');
test('time zones require a supported named identifier; UTC and fractional offsets work',()=>{
 for(const input of [null,{},[],"' OR 1=1",'+09:00','Mars/Olympus'])assert.throws(()=>canonicalTimeZone(input));
 assert.equal(canonicalTimeZone(), 'Asia/Tokyo');assert.equal(canonicalTimeZone('UTC'),'UTC');
 assert.equal(new Date(slotInstant('2026-10-29',18,'Asia/Kathmandu')).toISOString(),'2026-10-29T03:15:00.000Z');
 assert.equal(zonedParts(slotInstant('2026-10-29',18,'Asia/Tokyo'),'Asia/Kathmandu').time,'05:45');
});
test('candidate today and expiry use the event zone, never the viewer or host zone',()=>{
 const days=validateDays([{date:'2026-10-27',slots:[40,41],startAt:0}],created,created,'America/Los_Angeles');
 assert.deepEqual(days,[{date:'2026-10-27',slots:[40,41]}]);
 assert.equal(expiration(days,created,'America/Los_Angeles'),Date.parse('2026-10-28T07:00:00Z'));
 assert.throws(()=>validateDays([{date:'2026-11-27',slots:[18]}],created,created,'America/Los_Angeles'));
 assert.equal(expiration([{date:'2026-12-01',slots:[18]}],created,'America/New_York'),created+30*DAY_MS);
});
test('event clock-change days are rejected, including half-hour and skipped-day transitions',()=>{
 for(const [date,zone] of [['2026-11-01','America/New_York'],['2026-03-08','America/New_York'],['2026-10-25','Europe/London'],['2026-10-04','Australia/Lord_Howe'],['2011-12-30','Pacific/Apia']])assert.equal(isStableDay(date,zone),false,zone+' '+date);
 assert.equal(isStableDay('2026-10-31','America/New_York'),true);
 assert.throws(()=>validateDays([{date:'2026-11-01',slots:[18]}],created,created,'America/New_York'),/時計が切り替わる/);
});
test('local dates cross year boundaries and repeated local times keep distinct offsets',()=>{
 const newYear=slotInstant('2027-01-01',0,'Asia/Tokyo');assert.equal(zonedDate(newYear,'America/Los_Angeles'),'2026-12-31');
 const day={date:'2026-11-01',slots:[29,30,31,32],startAt:dayStart('2026-11-01','Asia/Tokyo')};const before=structuredClone(day);
 const c=makeClock('Asia/Tokyo','America/New_York',[day],'en');
 assert.equal(c.time(day.date,29),'01:30');assert.equal(c.time(day.date,31),'01:30');
 assert.match(c.full(day.date,29),/UTC-04:00/);assert.match(c.full(day.date,31),/UTC-05:00/);
 assert.equal(c.point(day.date,31)-c.point(day.date,29),3600000);assert.deepEqual(day,before);
});
test('stored anchors survive projection; CSV exports event, local and UTC instants safely',()=>{
 const day={date:'2026-10-29',slots:[18],startAt:Date.parse('2026-10-28T18:15:00Z')};
 assert.equal(slotInstant(day,18,'Asia/Kathmandu'),Date.parse('2026-10-29T03:15:00Z'));
 const event={timeZone:'Asia/Kathmandu',dates:[day]};const member={role:'participant',nickname:'=1+1',availability:{'2026-10-29':[18]}};
 const csv=eventCsv(event,[member],'en','America/Los_Angeles');
 assert.match(csv,/Start \(UTC\)/);assert.match(csv,/2026-10-29T09:00:00\+05:45/);assert.match(csv,/2026-10-28T20:15:00-07:00/);assert.match(csv,/2026-10-29T03:15:00.000Z/);assert(csv.includes('"\'=1+1"'));
 assert.equal(zonedIso(Date.parse('2026-10-29T03:15:00Z'),'Asia/Kathmandu'),'2026-10-29T09:00:00+05:45');
});
