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
 for(const f of readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 let seq=0;
 async function call(path,method='GET',body,cookie=''){const r=await mf.dispatchFetch('http://localhost/api/events'+path,{method,headers:{Origin:'http://localhost','Content-Type':'application/json','CF-Connecting-IP':'2001:db8::'+(++seq).toString(16),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const date=zonedDate(Date.now()+86400000);const proof={scheme:PASSWORD_SCHEME,salt:'a'.repeat(32),verifier:'b'.repeat(64)};
 const made=await call('','POST',{title:'Registration test',description:'Synthetic',nickname:'owner',password:proof,duration:60,dates:[{date,slots:[18,19]}],agreed:true});assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.id;
 const payload={password:proof,autoNickname:true,nicknameLanguage:'ja',nickname:'参加者1',availability:{[date]:[18]},revision:1,agreed:true};
 const results=await Promise.all(Array.from({length:8},()=>call('/'+id+'/join','POST',payload)));
 for(const r of results)assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal(new Set(results.map(r=>r.data.nickname)).size,8);
 assert.deepEqual(results.map(r=>Number(r.data.nickname.slice(3))).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
 assert.equal((await call('/'+id)).data.nextParticipantNumber,9);
 const first=results.find(r=>r.data.nickname==='参加者1');
 const params=await call('/'+id+'/credentials','POST',{nickname:'参加者1'});assert.equal(params.status,200);
 const login=await call('/'+id+'/login','POST',{nickname:'参加者1',password:proof});assert.equal(login.status,200);
 assert.equal((await call('/'+id+'/answer','DELETE',undefined,first.cookie)).status,200);
 assert.equal((await call('/'+id+'/join','POST',payload)).data.nickname,'参加者9');
 const manual=await call('/'+id+'/join','POST',{...payload,autoNickname:false,nickname:'参加者10'});assert.equal(manual.status,201);
 const skipped=await call('/'+id+'/join','POST',payload);assert.equal(skipped.data.nickname,'参加者11');
 assert.equal((await call('/'+id+'/join','POST',{...payload,nicknameLanguage:'en'})).data.nickname,'Participant 12');
 const duplicate=await call('/'+id+'/join','POST',{...payload,autoNickname:false,nickname:'参加者10'});assert.equal(duplicate.status,409);
 const invalid=await call('/'+id+'/join','POST',{...payload,autoNickname:false,nickname:'   '});assert.equal(invalid.status,400);
 const noOwner=await call('','POST',{title:'Invalid owner',nickname:'',autoNickname:true,password:proof,duration:60,dates:[{date,slots:[18,19]}],agreed:true});assert.equal(noOwner.status,400);
 console.log('PASS concurrent unique numbering, no reuse after deletion, manual collisions, English names, login and owner self-entry');
} finally {await mf.dispose();}
