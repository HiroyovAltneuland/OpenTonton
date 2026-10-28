import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {RATE_LIMIT_BINDINGS} from '../lib/edge-rate-config.mjs';
import {PASSWORD_SCHEME} from '../lib/password-client.ts';
import {dayStart,isStableDay,slotInstant,zonedDate} from '../lib/time-zone.ts';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=await import(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const mf=new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],ratelimits:Object.fromEntries(RATE_LIMIT_BINDINGS.map(({name,...config})=>[name,config]))}));
try {
 const db=await mf.getD1Database('DB');
 const migrations=readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort();
 async function migrate(name){for(const sql of readFileSync('drizzle/'+name,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();}
 for(const f of migrations.filter(x=>!x.startsWith('0002_')))await migrate(f);
 const oldId='1'.repeat(32),oldDate=zonedDate(Date.now()+86400000),oldExpiry=Date.now()+2*86400000;
 await db.prepare('INSERT INTO events(id,title,description,dates,duration,created_at,expires_at,status,revision,terms_version) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(oldId,'Legacy','',JSON.stringify([{date:oldDate,slots:[18,19]}]),60,Date.now(),oldExpiry,'open',1,'old').run();
 for(const f of migrations.filter(x=>x.startsWith('0002_')))await migrate(f);
 let seq=0;
 async function call(path,method='GET',body,cookie=''){const r=await mf.dispatchFetch('http://localhost/api/events'+path,{method,headers:{Origin:'http://localhost','Content-Type':'application/json','CF-Connecting-IP':'2001:db8::'+(++seq).toString(16),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const legacy=await call('/'+oldId);assert.equal(legacy.status,200);assert.equal(legacy.data.event.timeZone,'Asia/Tokyo');assert.equal(legacy.data.event.expiresAt,oldExpiry);assert.equal(legacy.data.event.dates[0].startAt,undefined);
 console.log('PASS additive migration preserves legacy event data and expiry as JST');
 const zone='America/New_York';const date=Array.from({length:10},(_,i)=>zonedDate(Date.now()+(i+1)*86400000,zone)).find(d=>isStableDay(d,zone));
 const proof={scheme:PASSWORD_SCHEME,salt:'a'.repeat(32),verifier:'b'.repeat(64)};
 const payload={title:'Timezone test only',description:'Synthetic',timeZone:zone,nickname:'owner',password:proof,duration:60,dates:[{date,slots:[18,19,20],startAt:0}],agreed:true};
 for(const invalid of [null,{},'+09:00',"' OR 1=1",'Mars/Olympus'])assert.equal((await call('','POST',{...payload,timeZone:invalid})).status,400);
 const created=await call('','POST',payload);assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
 const event=(await call('/'+id)).data.event;assert.equal(event.timeZone,zone);assert.equal(event.dates[0].startAt,dayStart(date,zone));assert.equal(event.expiresAt,slotInstant(date,48,zone));
 console.log('PASS event timezone, frozen UTC anchor, forged anchor rejection and local-midnight expiry');
 const joined=await call('/'+id+'/join','POST',{nickname:'participant',password:proof,availability:{[date]:[18,19]},revision:1,agreed:true});assert.equal(joined.status,201);
 const own=(await call('/'+id,'GET',undefined,joined.cookie)).data.me;
 assert.equal((await call('/'+id+'/answer','PATCH',{availability:{[date]:[19,20]},version:own.version,revision:1},joined.cookie)).status,200);
 const update={title:payload.title,description:payload.description,status:'confirmed',confirmed:date+'@18',revision:1};
 assert.equal((await call('/'+id,'PATCH',{...update,timeZone:'Asia/Tokyo'},created.cookie)).status,400);
 assert.equal((await call('/'+id,'PATCH',update,created.cookie)).status,200);
 const final=(await call('/'+id)).data;assert.equal(final.event.confirmed,date+'@18');assert.equal(final.event.timeZone,zone);assert.deepEqual(final.members.find(m=>m.role==='participant').availability,{[date]:[19,20]});
 console.log('PASS answers and confirmation retain event slot keys; timezone cannot be changed');
 const dst='2026-11-01';if(dst>=zonedDate(Date.now(),zone)&&dayStart(dst,zone)<Date.now()+29*86400000){const rejected=await call('','POST',{...payload,dates:[{date:dst,slots:[18,19]}]});assert.equal(rejected.status,400);assert.match(rejected.data.error,/時計が切り替わる/);console.log('PASS API rejects event-side DST transition dates');}
} finally {await mf.dispose();}
