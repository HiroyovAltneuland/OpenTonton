import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {RATE_LIMIT_BINDINGS} from '../lib/edge-rate-config.mjs';
import {stretchPassword} from '../lib/password-client.ts';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=await import(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
// Test-only scheduling barrier. No control routes or hooks enter the build.
const entry=`import worker from './index.js';
let armed=false,paused=false;
const digest=crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest=async(...args)=>{const result=await digest(...args);if(armed&&new TextDecoder().decode(args[1]).startsWith('OpenTonton stored verifier v1:')){armed=false;paused=true;const until=Date.now()+10000;while(paused&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));}return result;};
export default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path==='/__test/arm'){armed=true;return Response.json({ok:true})}if(path==='/__test/state')return Response.json({paused});if(path==='/__test/resume'){paused=false;return Response.json({ok:true})}return worker.fetch(request,env,ctx)}};`;
const mf=new Miniflare(convertV4MiniflareOptions({
 name:'security-integration',
 modules:[{type:'ESModule',path:resolve('dist/server/security-test-entry.js'),contents:entry},{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],
 modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 ratelimits:Object.fromEntries(RATE_LIMIT_BINDINGS.map(({name,...config})=>[name,config])),
}));
try{
 const db=await mf.getD1Database('DB');
 for(const migration of readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+migration,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 let sequence=0;
 async function call(path,method='GET',body,cookie='',ip='2001:db8::'+(++sequence).toString(16)){
  const r=await mf.dispatchFetch('http://localhost'+path,{method,headers:{Origin:'http://localhost','Content-Type':'application/json','CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
 }
 async function waitPaused(){for(let n=0;n<200;n++){if((await call('/__test/state')).data.paused)return;await new Promise(r=>setTimeout(r,5));}throw Error('Test barrier not reached');}
 const proof=(salt,value)=>({scheme:'client-pbkdf2-sha256-v1',salt:salt.repeat(32),verifier:value.repeat(64)});
 const password="' OR 1=1;--<script>alert(1)</script>";
 const firstProof=await stretchPassword(password);
 const nickname="' OR 1=1 --";
 const title="x'); DROP TABLE members;--";
 const description='</textarea><svg data-security-probe onload="alert(1)">';
 const day=new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10);
 const payload={title,description,nickname,password:firstProof,duration:60,dates:[{date:day,slots:[18,19]}],agreed:true};
 const created=await call('/api/events','POST',payload);assert.equal(created.status,201,JSON.stringify(created.data));
 const path='/api/events/'+created.data.id;
 const publicData=await call(path);assert.equal(publicData.data.event.title,title);assert.equal(publicData.data.event.description,description);assert.equal(publicData.data.members[0].nickname,nickname);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM members').first()).n,1);
 const missing=await call(path+'/login','POST',{nickname:"' OR 'a'='a",password:firstProof});assert.equal(missing.status,401);
 const joined=await call(path+'/join','POST',{nickname:'<img src=x onerror=1>',password:proof('e','5'),role:'owner',availability:{[day]:[18]},revision:1,agreed:true});assert.equal(joined.status,201);
 assert.equal((await call(path,'GET',undefined,joined.cookie)).data.me.role,'participant');
 for(const value of [{...firstProof,verifier:"' OR 1=1--"},{...firstProof,salt:'<script>'},{$ne:null},['injection']]){
  const rejected=await call('/api/events','POST',{...payload,password:value});assert.equal(rejected.status,400);
 }
 for(const field of ['title','description','nickname'])assert.equal((await call('/api/events','POST',{...payload,[field]:{$ne:null}})).status,400);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,1);
 console.log('PASS SQL strings remain data; HTML strings remain text; forged types, credentials and roles are rejected');
 // Pause an old-password login after verification, rotate credentials, resume.
 await call('/__test/arm');const login=call(path+'/login','POST',{nickname,password:firstProof});await waitPaused();
 const reset=await call(path+'/recover','POST',{nickname,recovery:created.data.recovery,password:proof('b','2')});assert.equal(reset.status,200);
 await call('/__test/resume');const staleLogin=await login;assert.equal(staleLogin.status,409);assert.equal(staleLogin.cookie,undefined);
 assert.equal((await call(path,'GET',undefined,created.cookie)).data.me,null);
 console.log('PASS old-password login in flight cannot issue a session after reset');
 // Two operations validate the same recovery code; only one may commit.
 await call('/__test/arm');const pendingRecovery=call(path+'/recover','POST',{nickname,recovery:reset.data.recovery,password:proof('c','3')});await waitPaused();
 const winner=await call(path+'/recover','POST',{nickname,recovery:reset.data.recovery,password:proof('d','4')});assert.equal(winner.status,200);
 await call('/__test/resume');assert.equal((await pendingRecovery).status,409);
 let owner=await call(path+'/login','POST',{nickname,password:proof('d','4')});assert.equal(owner.status,200);
 assert.equal((await call(path+'/login','POST',{nickname,password:proof('c','3')})).status,401);
 console.log('PASS recovery code is single-use across concurrent resets; losing attempt cannot invalidate winner');
 // A pending profile update must not overwrite a newer recovery.
 await call('/__test/arm');const pendingProfile=call(path+'/profile','PATCH',{nickname:'stale-profile',currentPassword:proof('d','4'),password:proof('e','5')},owner.cookie);await waitPaused();
 const finalReset=await call(path+'/recover','POST',{nickname,recovery:winner.data.recovery,password:proof('f','6')});assert.equal(finalReset.status,200);
 await call('/__test/resume');assert.equal((await pendingProfile).status,409);
 owner=await call(path+'/login','POST',{nickname,password:proof('f','6')});assert.equal(owner.status,200);
 assert.equal((await call(path,'GET',undefined,owner.cookie)).data.me.nickname,nickname);
 console.log('PASS concurrent profile update cannot overwrite recovery or revive a revoked session');
 // Verify protection on HTML, normal API, errors, and rate-limited responses.
 const html=await mf.dispatchFetch('http://localhost/',{headers:{'Content-Security-Policy':"script-src 'nonce-attacker'"}});assert.equal(html.status,200);
 const policy=html.headers.get('content-security-policy');assert(policy.includes("frame-ancestors 'none'"));assert(!policy.includes('attacker'));assert(!policy.includes("script-src 'unsafe-inline'"));
 const nonce=policy.match(/'nonce-([^']+)'/)[1];const text=await html.text();
 const scripts=[...text.matchAll(/<script\b([^>]*)>/gi)];assert(scripts.length>0);
 for(const [,attrs] of scripts)if(!/\bsrc=|type="application\/(json|ld\+json)"/.test(attrs))assert(attrs.includes(`nonce="${nonce}"`),'SSR inline script missing its CSP nonce: '+attrs);
 assert.equal(html.headers.get('x-frame-options'),'DENY');assert.equal(html.headers.get('referrer-policy'),'no-referrer');assert.equal(html.headers.get('cache-control'),'no-store');
 const nextHtml=await mf.dispatchFetch('http://localhost/');assert.notEqual(nextHtml.headers.get('content-security-policy'),policy);await nextHtml.body.cancel();
 const rejectedPath=await call('/api/events/not-valid','POST',{});assert.equal(rejectedPath.status,404);assert.equal(rejectedPath.headers.get('x-frame-options'),'DENY');
 console.log('PASS fresh CSP nonces cover SSR scripts; framing/referrer/cache headers protect HTML and API errors');
 // Use the exact production native limiter thresholds in an isolated DB.
 const remaining=60000-Date.now()%60000;if(remaining<5000)await new Promise(r=>setTimeout(r,remaining+50));
 const counters=async()=>JSON.stringify((await db.prepare('SELECT key,count FROM rate_limits ORDER BY key').all()).results);
 const burstIP='192.0.2.99';for(let n=0;n<10;n++)assert.equal((await call('/api/events','POST',{agreed:false},'',burstIP)).status,400);
 const before=await counters();const burst=await call('/api/events','POST',{agreed:false},'',burstIP);assert.equal(burst.status,429);assert.equal(await counters(),before);assert.equal(burst.headers.get('x-frame-options'),'DENY');assert(Number(burst.headers.get('retry-after'))>0);
 console.log('PASS create burst rejected before D1; rejected requests leave DB counters unchanged');
 const readLimit=RATE_LIMIT_BINDINGS.find(x=>x.name==='API_READ_LIMIT').simple.limit;
 const readIP='192.0.2.100';for(let n=0;n<readLimit;n++)assert.equal((await call(path,'GET',undefined,'',readIP)).status,200);
 const beforeRead=await counters();assert.equal((await call(path,'GET',undefined,'',readIP)).status,429);assert.equal(await counters(),beforeRead);
 const writeLimit=RATE_LIMIT_BINDINGS.find(x=>x.name==='API_WRITE_LIMIT').simple.limit;
 const writeIP='192.0.2.101';for(let n=0;n<writeLimit;n++)await call(path+'/login','POST',{nickname,password:firstProof},'',writeIP);
 const beforeWrite=await counters();assert.equal((await call(path+'/login','POST',{nickname,password:firstProof},'',writeIP)).status,429);assert.equal(await counters(),beforeWrite);
 console.log('PASS read/write admission limits protect D1; rejected DB-backed auth counters stop growing');
 const big=JSON.stringify({...payload,description:'x'.repeat(70000)});let sent=false;
 const response=await mf.dispatchFetch('http://localhost/api/events',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.102'},body:new ReadableStream({pull(c){if(sent)c.close();else{sent=true;c.enqueue(new TextEncoder().encode(big));}}}),duplex:'half'});
 assert.equal(response.status,413);await response.body.cancel();assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,1);
 console.log('PASS oversized chunked JSON is rejected without inserting data');
 console.log('All security regression checks passed.');
}finally{await mf.dispose()}
