import { env } from 'cloudflare:workers';
import { canonicalNickname, expiration, validateAvailability, validateDays, type EventData, type Member, type Snapshot } from './scheduling';
const VERSION='2026-10-28-draft';
const encoder=new TextEncoder();
const db=()=>{if(!env.DB)throw new OperationError('OT_DB_NOT_CONFIGURED');return env.DB;};
class OperationError extends Error { constructor(public code:string){super(code);} }
class HttpError extends Error { constructor(public status:number,message:string,public headers:Record<string,string>={}){super(message);} }
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
const id=()=>crypto.randomUUID().replaceAll('-','');
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const hex=(value:Uint8Array)=>Array.from(value).map(x=>x.toString(16).padStart(2,'0')).join('');
const same=(a:string,b:string)=>{let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;};
async function passwordHash(value:unknown,salt=hex(crypto.getRandomValues(new Uint8Array(16)))) {
  if(typeof value!=='string'||value.length<10||value.length>128)fail(400,'パスワードは10〜128文字で設定してください。');
  try {
    const key=await crypto.subtle.importKey('raw',encoder.encode(value as string),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:encoder.encode(salt)},key,256);
    return `pbkdf2-sha256$600000$${salt}$${hex(new Uint8Array(bits))}`;
  } catch(error) {
    // Report a fixed category only; native exception messages can contain inputs.
    const message=error instanceof Error?error.message:'';
    throw new OperationError(/iteration counts above.*not supported/i.test(message)?'OT_AUTH_HASH_LIMIT':'OT_AUTH_HASH_FAILED');
  }
}
async function verifyPassword(value:unknown,stored:string) {
  if(typeof value!=='string'||value.length<10||value.length>128)return false;
  return same(await passwordHash(value,stored.split('$')[2]),stored);
}
function parseEvent(row:any):EventData {return {id:row.id,title:row.title,description:row.description,dates:JSON.parse(row.dates),duration:row.duration,createdAt:row.created_at,expiresAt:row.expires_at,status:row.status,confirmed:row.confirmed,revision:row.revision};}
function parseMember(row:any):Member{return {id:row.id,nickname:row.nickname,role:row.role,availability:JSON.parse(row.availability),version:row.version};}
const cookieName=(eventId:string)=>`ot_${eventId}`;
const cookie=(request:Request,eventId:string,token:string,expires:number)=>`${cookieName(eventId)}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((expires-Date.now())/1000))}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
async function session(request:Request,eventId:string){
  const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(eventId)+'='))?.split('=')[1];
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  return await db().prepare('SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token=? AND s.expires_at>? AND m.event_id=?').bind(await hash(token),Date.now(),eventId).first<any>();
}
async function issueSession(request:Request,event:EventData,memberId:string){
  const token=id()+id();const expires=Math.min(Date.now()+7*86400000,event.expiresAt);
  await db().prepare('INSERT INTO sessions(token,member_id,expires_at) VALUES(?,?,?)').bind(await hash(token),memberId,expires).run();
  return cookie(request,event.id,token,expires);
}
async function rateBucket(request:Request,scope:string,window:number){
  const now=Date.now();const bucket=Math.floor(now/window);const address=request.headers.get('cf-connecting-ip')||'local';
  // Short-lived one-way bucket identifiers; never store the raw address.
  return {key:await hash(`${scope}:${address}:${bucket}`),expires:(bucket+1)*window};
}
function rateExceeded(expires:number,message:string):never {
  throw new HttpError(429,message,{'Retry-After':String(Math.max(1,Math.ceil((expires-Date.now())/1000)))});
}
async function limit(request:Request,scope:string,max:number,window:number,message='操作が多くなっています。少し時間をおいてからお試しください。'){
  const {key,expires}=await rateBucket(request,scope,window);
  const row=await db().prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,expires).first<{count:number}>();
  if((row?.count||0)>max)rateExceeded(expires,message);
}
const creationLimitMessage='この接続元からの作成件数が1時間の上限（20件）に達しました。次の毎時00分以降にお試しください。';
async function creationQuota(request:Request){
  const quota=await rateBucket(request,'create-success',3600000);
  const row=await db().prepare('SELECT count FROM rate_limits WHERE key=?').bind(quota.key).first<{count:number}>();
  if((row?.count||0)>=20)rateExceeded(quota.expires,creationLimitMessage);
  return quota;
}
export async function cleanup(database:D1Database,now=Date.now()) {
  // Bounded batches prevent cleanup itself consuming an unbounded request budget.
  await database.batch([
    database.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE expires_at<=? LIMIT 100)').bind(now),
    database.prepare('DELETE FROM sessions WHERE token IN (SELECT token FROM sessions WHERE expires_at<=? LIMIT 500)').bind(now),
    database.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<=? LIMIT 500)').bind(now),
  ]);
}
async function activeEvent(eventId:string) {
  if(!/^[a-f0-9]{32}$/.test(eventId))fail(404,'イベントが見つかりません。');
  const row=await db().prepare('SELECT * FROM events WHERE id=?').bind(eventId).first<any>();
  if(!row)fail(404,'イベントが見つからないか、削除されています。');
  if(row.expires_at<=Date.now()){await cleanup(db());fail(410,'保存期限を過ぎたため、このイベントは利用できません。');}
  return parseEvent(row);
}
async function snapshot(request:Request,event:EventData):Promise<Snapshot>{
  const rows=await db().prepare('SELECT id,nickname,role,availability,version FROM members WHERE event_id=? ORDER BY created_at,id').bind(event.id).all();
  const me=await session(request,event.id);
  return {event,members:rows.results.map(parseMember),me:me?parseMember(me):null};
}
function text(value:unknown,max:number,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(400,`入力内容を確認してください（最大${max}文字）。`);return (value as string).trim();}
const duration=(value:unknown)=>{if(![30,60,90,120].includes(value as number))fail(400,'開催時間を選択してください。');return value as number;};
async function body(request:Request){const raw=await request.text();if(encoder.encode(raw).length>64000)fail(413,'入力内容が大きすぎます。');try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'入力形式を確認してください。');return value;}catch{fail(400,'入力形式を確認してください。');}}
const agree=(data:any)=>{if(data.agreed!==true)fail(400,'利用条件と削除期限への同意が必要です。');};
export async function api(request:Request):Promise<Response>{
  try{
    const url=new URL(request.url);const parts=url.pathname.split('/').filter(Boolean).slice(1);const method=request.method;
    if(method!=='GET'){
      if(request.headers.get('origin')!==url.origin)fail(403,'同じサイトから操作してください。');
      if(!(request.headers.get('content-type')||'').includes('application/json'))fail(415,'JSON形式で送信してください。');
      if(Number(request.headers.get('content-length')||0)>64000)fail(413,'入力内容が大きすぎます。');
      const creating=parts[0]==='events'&&parts.length===1&&method==='POST';
      if(creating)await limit(request,'create-attempt',10,60000,'作成リクエストが1分間の上限（10回）に達しました。次の分になってからお試しください。');
      else await limit(request,'write',180,3600000);
      await cleanup(db());
    }
    if(parts[0]!=='events')fail(404,'ページが見つかりません。');
    if(parts.length===1&&method==='POST'){
      await creationQuota(request);
      const total=await db().prepare('SELECT COUNT(*) AS n FROM events').first<{n:number}>();if((total?.n||0)>=5000)fail(503,'現在、新規作成を受け付けていません。');
      const data=await body(request);agree(data);const now=Date.now();
      const days=validateDays(data.dates,now);const eventId=id();const memberId=id();const nickname=canonicalNickname(data.nickname);const recovery=id();
      const event:EventData={id:eventId,title:text(data.title,80,true),description:text(data.description,500),dates:days,duration:duration(data.duration),createdAt:now,expiresAt:expiration(days,now),status:'open',confirmed:null,revision:1};
      if(!days.some(d=>d.slots.some(start=>Array.from({length:event.duration/30},(_,i)=>start+i).every(s=>d.slots.includes(s)))))fail(400,'開催時間を満たす連続した候補時間帯を設定してください。');
      const pass=await passwordHash(data.password);
      // Recompute the hourly bucket after hashing, then enforce it inside the
      // same transaction as the event, owner and session. Failures roll back
      // everything; concurrent creates cannot exceed 20 successful commits.
      const quota=await creationQuota(request);
      const token=id()+id();const sessionExpires=Math.min(Date.now()+7*86400000,event.expiresAt);
      const result=await db().batch([
        db().prepare('INSERT INTO events(id,title,description,dates,duration,created_at,expires_at,status,revision,terms_version) SELECT ?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT count FROM rate_limits WHERE key=?),0)<20').bind(eventId,event.title,event.description,JSON.stringify(days),event.duration,now,event.expiresAt,'open',1,VERSION,quota.key),
        db().prepare('INSERT INTO members(id,event_id,nickname,role,password,recovery,availability,version,created_at,agreed_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?)').bind(memberId,eventId,nickname,'owner',pass,await hash(recovery),'{}',1,now,now,eventId),
        db().prepare('INSERT INTO sessions(token,member_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?)').bind(await hash(token),memberId,sessionExpires,eventId),
        db().prepare('INSERT INTO rate_limits(key,count,expires_at) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(quota.key,quota.expires,eventId),
      ]);
      if(!result[0].meta.changes)rateExceeded(quota.expires,creationLimitMessage);
      return json({id:eventId,recovery},201,{'Set-Cookie':cookie(request,event.id,token,sessionExpires)});
    }
    const eventId=parts[1];const event=await activeEvent(eventId);const action=parts[2];
    if(parts.length===2&&method==='GET')return json(await snapshot(request,event));
    if(action==='login'&&method==='POST'){
      await limit(request,`login:${eventId}`,12,900000);const data=await body(request);const nickname=canonicalNickname(data.nickname);
      const member=await db().prepare('SELECT * FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first<any>();
      if(!member||!await verifyPassword(data.password,member.password))fail(401,'ニックネームまたはパスワードを確認してください。');
      return json({ok:true},200,{'Set-Cookie':await issueSession(request,event,member.id)});
    }
    if(action==='recover'&&method==='POST'){
      await limit(request,`login:${eventId}`,12,900000);const data=await body(request);const nickname=canonicalNickname(data.nickname);
      const member=await db().prepare('SELECT * FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first<any>();
      if(!member||typeof data.recovery!=='string'||!same(await hash(data.recovery.trim()),member.recovery))fail(401,'ニックネームまたは復旧コードを確認してください。');
      const recovery=id();const password=await passwordHash(data.password);
      await db().batch([db().prepare('UPDATE members SET password=?,recovery=? WHERE id=?').bind(password,await hash(recovery),member.id),db().prepare('DELETE FROM sessions WHERE member_id=?').bind(member.id)]);
      return json({recovery},200,{'Set-Cookie':await issueSession(request,event,member.id)});
    }
    if(action==='join'&&method==='POST'){
      if(event.status!=='open')fail(409,'回答の受付は終了しています。');
      const data=await body(request);agree(data);if(data.revision!==event.revision)fail(409,'候補が変更されました。画面を更新してください。');
      const nickname=canonicalNickname(data.nickname);const existing=await db().prepare('SELECT id FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first();if(existing)fail(409,'このニックネームは使われています。別の名前にするかログインしてください。');
      const count=await db().prepare('SELECT COUNT(*) AS n FROM members WHERE event_id=?').bind(eventId).first<{n:number}>();if((count?.n||0)>=101)fail(409,'参加者数の上限に達しました。');
      const availability=validateAvailability(data.availability,event.dates);const memberId=id();const recovery=id();const pass=await passwordHash(data.password);const now=Date.now();
      // The conditional insert makes the participant cap robust to concurrent registrations.
      const result=await db().prepare('INSERT INTO members(id,event_id,nickname,role,password,recovery,availability,version,created_at,agreed_at) SELECT ?,?,?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM members WHERE event_id=?)<101 AND EXISTS(SELECT 1 FROM events WHERE id=? AND revision=? AND status=\'open\' AND expires_at>?)').bind(memberId,eventId,nickname,'participant',pass,await hash(recovery),JSON.stringify(availability),now,now,eventId,eventId,event.revision,now).run();
      if(!result.meta.changes)fail(409,'受付状況が変更されました。画面を更新してください。');
      return json({recovery},201,{'Set-Cookie':await issueSession(request,event,memberId)});
    }
    const me=await session(request,eventId);if(!me)fail(401,'ニックネームとパスワードでログインしてください。');
    if(action==='logout'&&method==='POST'){
      const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(eventId)+'='))?.split('=')[1];
      if(token)await db().prepare('DELETE FROM sessions WHERE token=?').bind(await hash(token)).run();
      return json({ok:true},200,{'Set-Cookie':cookie(request,eventId,'',0)});
    }
    if(action==='answer'&&method==='PATCH'){
      if(me.role!=='participant')fail(403,'オーナーは候補時間の設定から編集してください。');
      if(event.status!=='open')fail(409,'回答の受付は終了しています。');
      const data=await body(request);const availability=validateAvailability(data.availability,event.dates);
      const result=await db().prepare('UPDATE members SET availability=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM events WHERE id=? AND revision=? AND status=\'open\' AND expires_at>?)').bind(JSON.stringify(availability),me.id,data.version,eventId,data.revision,Date.now()).run();
      if(!result.meta.changes)fail(409,'回答または候補が更新されています。画面を更新してから再度編集してください。');
      return json({ok:true});
    }
    if(action==='profile'&&method==='PATCH'){
      const data=await body(request);if(!await verifyPassword(data.currentPassword,me.password))fail(401,'現在のパスワードを確認してください。');
      const nickname=canonicalNickname(data.nickname);const duplicate=await db().prepare('SELECT id FROM members WHERE event_id=? AND nickname=? AND id<>?').bind(eventId,nickname,me.id).first();if(duplicate)fail(409,'そのニックネームは使われています。');
      const pass=data.password?await passwordHash(data.password):me.password;
      await db().batch([db().prepare('UPDATE members SET nickname=?,password=?,version=version+1 WHERE id=?').bind(nickname,pass,me.id),db().prepare('DELETE FROM sessions WHERE member_id=?').bind(me.id)]);
      return json({ok:true},200,{'Set-Cookie':await issueSession(request,event,me.id)});
    }
    if(action==='answer'&&method==='DELETE'){
      if(me.role!=='participant')fail(403,'オーナーはイベント削除を使用してください。');
      await db().prepare('DELETE FROM members WHERE id=?').bind(me.id).run();return json({ok:true},200,{'Set-Cookie':cookie(request,eventId,'',0)});
    }
    if(me.role!=='owner')fail(403,'この操作はオーナーのみ利用できます。');
    if(action==='member'&&method==='DELETE'){
      const data=await body(request);await db().prepare('DELETE FROM members WHERE id=? AND event_id=? AND role=\'participant\'').bind(data.memberId,eventId).run();return json({ok:true});
    }
    if(parts.length===2&&method==='DELETE'){
      const data=await body(request);if(!await verifyPassword(data.password,me.password))fail(401,'パスワードを確認してください。');
      await db().prepare('DELETE FROM events WHERE id=?').bind(eventId).run();return json({ok:true},200,{'Set-Cookie':cookie(request,eventId,'',0)});
    }
    if(parts.length===2&&method==='PATCH'){
      const data=await body(request);const title=text(data.title,80,true),description=text(data.description,500);const state=data.status;
      if(!['open','closed','confirmed'].includes(state))fail(400,'受付状態を確認してください。');
      let confirmed:string|null=null;
      if(state==='confirmed'){
        if(typeof data.confirmed!=='string')fail(400,'確定日時を選んでください。');
        const [date,startText]=data.confirmed.split('@');const start=Number(startText);const day=event.dates.find(d=>d.date===date);
        if(!Number.isInteger(start)||!day||!Array.from({length:event.duration/30},(_,i)=>start+i).every(s=>day.slots.includes(s)))fail(400,'候補内の連続した時間帯を選んでください。');
        confirmed=data.confirmed;
      }
      const result=await db().prepare('UPDATE events SET title=?,description=?,status=?,confirmed=?,revision=revision+1 WHERE id=? AND revision=? AND expires_at>?').bind(title,description,state,confirmed,eventId,data.revision,Date.now()).run();
      if(!result.meta.changes)fail(409,'イベントが更新されています。画面を更新してください。');return json({ok:true});
    }
    return fail(404,'操作が見つかりません。');
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status,error.headers);
    if(error instanceof Error&&/^(候補|回答|ニックネーム)/.test(error.message))return json({error:error.message},400);
    // Fixed diagnostic codes remain available with observability disabled. Never
    // return or log raw exceptions, request bodies, IP addresses, or credentials.
    const message=error instanceof Error?error.message:'';
    const code=error instanceof OperationError?error.code:
      /no such (?:table|column)|has no column named/i.test(message)?'OT_DB_SCHEMA':
      /D1_ERROR|D1_EXEC_ERROR|SQLITE_/i.test(message)?'OT_DB_FAILED':'OT_INTERNAL';
    return json({error:`処理できませんでした。エラーコード：${code}`,code},500);
  }
}
