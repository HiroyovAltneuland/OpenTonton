import { canonicalTimeZone, slotInstant } from './time-zone';
import { env } from 'cloudflare:workers';
import { PASSWORD_SCHEME, PASSWORD_ITERATIONS, randomPasswordSalt, validPasswordProof } from './password-client';
import { canonicalNickname, expiration, validateAvailability, validateDays, type EventData, type Member, type Snapshot } from './scheduling';
const VERSION='2026-10-29-draft';
const encoder=new TextEncoder();
const db=()=>{if(!env.DB)throw new OperationError('OT_DB_NOT_CONFIGURED');return env.DB;};
class OperationError extends Error { constructor(public code:string){super(code);} }
class HttpError extends Error { constructor(public status:number,message:string,public headers:Record<string,string>={}){super(message);} }
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
const id=()=>crypto.randomUUID().replaceAll('-','');
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const hex=(value:Uint8Array)=>Array.from(value).map(x=>x.toString(16).padStart(2,'0')).join('');
const same=(a:string,b:string)=>{let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;};
// Store a salted digest of the stretched credential, never the credential that
// can be replayed at login. A DB-only leak still requires the per-user 600k KDF
// for every password guess. HTTPS and the no-credential-logging rule are required.
const storedVerifier=(verifier:string,salt:string,serverSalt:string)=>hash(`OpenTonton stored verifier v1:${salt}:${serverSalt}:${verifier}`);
function passwordRecord(stored:string){
  const [scheme,iterations,salt,serverSalt,digest,...extra]=stored.split('$');
  if(scheme!==PASSWORD_SCHEME||iterations!==String(PASSWORD_ITERATIONS)||extra.length||!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{32}$/.test(serverSalt||'')||!/^[a-f0-9]{64}$/.test(digest||''))return null;
  return {salt,serverSalt,digest};
}
async function passwordHash(value:unknown) {
  if(typeof value==='string')fail(409,'認証方式が更新されました。画面を再読み込みしてからお試しください。');
  if(!validPasswordProof(value))return fail(400,'パスワードの送信形式を確認してください。画面を再読み込みしてください。');
  const serverSalt=randomPasswordSalt();
  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${value.salt}$${serverSalt}$${await storedVerifier(value.verifier,value.salt,serverSalt)}`;
}
async function verifyPassword(value:unknown,stored:string) {
  if(typeof value==='string')fail(409,'認証方式が更新されました。画面を再読み込みしてからお試しください。');
  const record=passwordRecord(stored);
  // Legacy hashes cannot be verified under Workers' iteration cap. Do not
  // expose them as login credentials or silently weaken their work factor.
  if(!record&&stored.startsWith('pbkdf2-sha256$'))fail(409,'以前の認証形式です。復旧コードからパスワードを再設定してください。');
  if(!record||!validPasswordProof(value)||!same(value.salt,record.salt))return false;
  return same(await storedVerifier(value.verifier,record.salt,record.serverSalt),record.digest);
}
function parseEvent(row:any):EventData {return {id:row.id,timeZone:row.time_zone||'Asia/Tokyo',title:row.title,description:row.description,dates:JSON.parse(row.dates),duration:row.duration,createdAt:row.created_at,expiresAt:row.expires_at,status:row.status,confirmed:row.confirmed,revision:row.revision};}
function parseMember(row:any):Member{return {id:row.id,nickname:row.nickname,role:row.role,availability:JSON.parse(row.availability),version:row.version};}
const cookieName=(eventId:string)=>`ot_${eventId}`;
const cookie=(request:Request,eventId:string,token:string,expires:number)=>`${cookieName(eventId)}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((expires-Date.now())/1000))}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
async function session(request:Request,eventId:string){
  const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(eventId)+'='))?.split('=')[1];
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  return await db().prepare('SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token=? AND s.expires_at>? AND m.event_id=? AND s.auth_version=m.auth_version').bind(await hash(token),Date.now(),eventId).first<any>();
}
async function sessionGrant(request:Request,event:EventData,memberId:string,authVersion:string){
  const token=id()+id();const expires=Math.min(Date.now()+7*86400000,event.expiresAt);
  const statement=db().prepare('INSERT INTO sessions(token,member_id,expires_at,auth_version) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members m JOIN events e ON e.id=m.event_id WHERE m.id=? AND m.event_id=? AND m.auth_version=? AND e.expires_at>?)').bind(await hash(token),memberId,expires,authVersion,memberId,event.id,authVersion,Date.now());
  return {statement,cookie:cookie(request,event.id,token,expires)};
}
async function issueSession(request:Request,event:EventData,member:{id:string;auth_version:string}){
  const grant=await sessionGrant(request,event,member.id,member.auth_version);
  const result=await grant.statement.run();
  if(!result.meta.changes)fail(409,'認証情報が変更されました。再度ログインしてください。');
  return grant.cookie;
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
  const row=await db().prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(key,expires,max).first<{count:number}>();
  if(!row)rateExceeded(expires,message);
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
  const sequence=await db().prepare('SELECT participant_sequence FROM events WHERE id=?').bind(event.id).first<{participant_sequence:number}>();
  return {event,members:rows.results.map(parseMember),me:me?parseMember(me):null,nextParticipantNumber:(sequence?.participant_sequence||0)+1};
}
function text(value:unknown,max:number,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(400,`入力内容を確認してください（最大${max}文字）。`);return (value as string).trim();}
const duration=(value:unknown)=>{if(![30,60,90,120].includes(value as number))fail(400,'開催時間を選択してください。');return value as number;};
async function body(request:Request){
  const reader=request.body?.getReader();if(!reader)return fail(400,'入力形式を確認してください。');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000){await reader.cancel();fail(413,'入力内容が大きすぎます。');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'入力形式を確認してください。');return value;}catch{fail(400,'入力形式を確認してください。');}
}
const agree=(data:any)=>{if(data.agreed!==true)fail(400,'利用条件と削除期限への同意が必要です。');};
export async function api(request:Request):Promise<Response>{
  try{
    const url=new URL(request.url);const parts=url.pathname.split('/').filter(Boolean).slice(1);const method=request.method;
    if(method!=='GET'){
      if(request.headers.get('origin')!==url.origin)fail(403,'同じサイトから操作してください。');
      if(!(request.headers.get('content-type')||'').includes('application/json'))fail(415,'JSON形式で送信してください。');
      if(Number(request.headers.get('content-length')||0)>64000)fail(413,'入力内容が大きすぎます。');
      const creating=parts[0]==='events'&&parts.length===1&&method==='POST';
      // Short-window admission is handled before D1 in the Worker.
      if(!creating)await limit(request,'write',180,3600000);
      await cleanup(db());
    }
    if(parts[0]!=='events')fail(404,'ページが見つかりません。');
    if(parts.length===1&&method==='POST'){
      await creationQuota(request);
      const total=await db().prepare('SELECT COUNT(*) AS n FROM events').first<{n:number}>();if((total?.n||0)>=5000)fail(503,'現在、新規作成を受け付けていません。');
      const data=await body(request);agree(data);const now=Date.now();
      const timeZone=canonicalTimeZone(data.timeZone);
      const days=validateDays(data.dates,now,now,timeZone).map(d=>({...d,startAt:slotInstant(d.date,0,timeZone)}));const eventId=id();const memberId=id();const nickname=canonicalNickname(data.nickname);const recovery=id();
      const event:EventData={id:eventId,timeZone,title:text(data.title,80,true),description:text(data.description,500),dates:days,duration:duration(data.duration),createdAt:now,expiresAt:expiration(days,now,timeZone),status:'open',confirmed:null,revision:1};
      if(!days.some(d=>d.slots.some(start=>Array.from({length:event.duration/30},(_,i)=>start+i).every(s=>d.slots.includes(s)))))fail(400,'開催時間を満たす連続した候補時間帯を設定してください。');
      const pass=await passwordHash(data.password);
      // Recompute the hourly bucket after hashing, then enforce it inside the
      // same transaction as the event, owner and session. Failures roll back
      // everything; concurrent creates cannot exceed 20 successful commits.
      const quota=await creationQuota(request);
      const token=id()+id();const sessionExpires=Math.min(Date.now()+7*86400000,event.expiresAt);
      const result=await db().batch([
        db().prepare('INSERT INTO events(id,time_zone,title,description,dates,duration,created_at,expires_at,status,revision,terms_version) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT count FROM rate_limits WHERE key=?),0)<20').bind(eventId,timeZone,event.title,event.description,JSON.stringify(days),event.duration,now,event.expiresAt,'open',1,VERSION,quota.key),
        db().prepare('INSERT INTO members(id,event_id,nickname,role,password,recovery,availability,version,created_at,agreed_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?)').bind(memberId,eventId,nickname,'owner',pass,await hash(recovery),'{}',1,now,now,eventId),
        db().prepare('INSERT INTO sessions(token,member_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?)').bind(await hash(token),memberId,sessionExpires,eventId),
        db().prepare('INSERT INTO rate_limits(key,count,expires_at) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM events WHERE id=?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(quota.key,quota.expires,eventId),
      ]);
      if(!result[0].meta.changes)rateExceeded(quota.expires,creationLimitMessage);
      return json({id:eventId,recovery},201,{'Set-Cookie':cookie(request,event.id,token,sessionExpires)});
    }
    const eventId=parts[1];const event=await activeEvent(eventId);const action=parts[2];
    if(parts.length===2&&method==='GET')return json(await snapshot(request,event));
    if(action==='credentials'&&method==='POST'){
      await limit(request,`credentials:${eventId}`,60,900000);
      const data=await body(request);
      const member=data.self===true?await session(request,eventId):await db().prepare('SELECT password FROM members WHERE event_id=? AND nickname=?').bind(eventId,canonicalNickname(data.nickname)).first<{password:string}>();
      if(data.self===true&&!member)fail(401,'ニックネームとパスワードでログインしてください。');
      const record=member?passwordRecord(member.password):null;
      if(member&&!record&&member.password.startsWith('pbkdf2-sha256$'))fail(409,'以前の認証形式です。復旧コードからパスワードを再設定してください。');
      // Salts are public KDF parameters. Unknown names get the same shape;
      // stored digests, server salts and recovery codes are never returned.
      return json({scheme:PASSWORD_SCHEME,salt:record?.salt||randomPasswordSalt()});
    }
    if(action==='login'&&method==='POST'){
      await limit(request,`login:${eventId}`,12,900000);const data=await body(request);const nickname=canonicalNickname(data.nickname);
      const member=await db().prepare('SELECT * FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first<any>();
      if(!member||!await verifyPassword(data.password,member.password))fail(401,'ニックネームまたはパスワードを確認してください。');
      return json({ok:true},200,{'Set-Cookie':await issueSession(request,event,member)});
    }
    if(action==='recover'&&method==='POST'){
      await limit(request,`login:${eventId}`,12,900000);const data=await body(request);const nickname=canonicalNickname(data.nickname);
      const member=await db().prepare('SELECT * FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first<any>();
      if(!member||typeof data.recovery!=='string'||!same(await hash(data.recovery.trim()),member.recovery))fail(401,'ニックネームまたは復旧コードを確認してください。');
      const recovery=id();const password=await passwordHash(data.password);const authVersion=id();
      const recoveryHash=await hash(recovery);const grant=await sessionGrant(request,event,member.id,authVersion);
      const result=await db().batch([
        db().prepare('UPDATE members SET password=?,recovery=?,auth_version=? WHERE id=? AND recovery=? AND auth_version=?').bind(password,recoveryHash,authVersion,member.id,member.recovery,member.auth_version),
        db().prepare('DELETE FROM sessions WHERE member_id=? AND auth_version<>(SELECT auth_version FROM members WHERE id=?)').bind(member.id,member.id),
        grant.statement,
      ]);
      if(!result[0].meta.changes||!result[2].meta.changes)fail(409,'認証情報が変更されました。最新の復旧コードでお試しください。');
      return json({recovery},200,{'Set-Cookie':grant.cookie});
    }
    if(action==='join'&&method==='POST'){
      if(event.status!=='open')fail(409,'回答の受付は終了しています。');
      const data=await body(request);agree(data);if(data.revision!==event.revision)fail(409,'候補が変更されました。画面を更新してください。');
      const automatic=data.autoNickname===true;let nickname=automatic?'':canonicalNickname(data.nickname);if(!automatic){const existing=await db().prepare('SELECT id FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first();if(existing)fail(409,'このニックネームは使われています。別の名前にするかログインしてください。');}
      const count=await db().prepare('SELECT COUNT(*) AS n FROM members WHERE event_id=?').bind(eventId).first<{n:number}>();if((count?.n||0)>=101)fail(409,'参加者数の上限に達しました。');
      const availability=validateAvailability(data.availability,event.dates);const memberId=id();const recovery=id();const pass=await passwordHash(data.password);const now=Date.now();
      const recoveryHash=await hash(recovery);
      for(let attempt=0;attempt<102;attempt++){
        if(automatic){
          const allocated=await db().prepare("UPDATE events SET participant_sequence=participant_sequence+1 WHERE id=? AND revision=? AND status='open' AND expires_at>? RETURNING participant_sequence").bind(eventId,event.revision,now).first<{participant_sequence:number}>();
          if(!allocated)fail(409,'受付状況が変更されました。画面を更新してください。');
          nickname=(data.nicknameLanguage==='en'?'Participant ':'参加者')+allocated!.participant_sequence;
        }
        const result=await db().prepare("INSERT INTO members(id,event_id,nickname,role,password,recovery,availability,version,created_at,agreed_at) SELECT ?,?,?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM members WHERE event_id=?)<101 AND EXISTS(SELECT 1 FROM events WHERE id=? AND revision=? AND status='open' AND expires_at>?) ON CONFLICT(event_id,nickname) DO NOTHING").bind(memberId,eventId,nickname,'participant',pass,recoveryHash,JSON.stringify(availability),now,now,eventId,eventId,event.revision,now).run();
        if(result.meta.changes)return json({recovery,nickname},201,{'Set-Cookie':await issueSession(request,event,{id:memberId,auth_version:'initial'})});
        const collision=await db().prepare('SELECT id FROM members WHERE event_id=? AND nickname=?').bind(eventId,nickname).first();
        if(!collision)fail(409,'受付状況が変更されました。画面を更新してください。');
        if(!automatic)fail(409,'このニックネームは使われています。別の名前にするかログインしてください。');
      }
      fail(409,'受付状況が変更されました。画面を更新してください。');
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
      const result=await db().prepare('UPDATE members SET availability=?,version=version+1 WHERE id=? AND version=? AND auth_version=? AND EXISTS(SELECT 1 FROM events WHERE id=? AND revision=? AND status=\'open\' AND expires_at>?)').bind(JSON.stringify(availability),me.id,data.version,me.auth_version,eventId,data.revision,Date.now()).run();
      if(!result.meta.changes)fail(409,'回答または候補が更新されています。画面を更新してから再度編集してください。');
      return json({ok:true});
    }
    if(action==='profile'&&method==='PATCH'){
      const data=await body(request);if(!await verifyPassword(data.currentPassword,me.password))fail(401,'現在のパスワードを確認してください。');
      const nickname=canonicalNickname(data.nickname);const duplicate=await db().prepare('SELECT id FROM members WHERE event_id=? AND nickname=? AND id<>?').bind(eventId,nickname,me.id).first();if(duplicate)fail(409,'そのニックネームは使われています。');
      const pass=data.password?await passwordHash(data.password):me.password;const authVersion=id();
      const grant=await sessionGrant(request,event,me.id,authVersion);
      const result=await db().batch([
        db().prepare('UPDATE members SET nickname=?,password=?,auth_version=?,version=version+1 WHERE id=? AND auth_version=?').bind(nickname,pass,authVersion,me.id,me.auth_version),
        db().prepare('DELETE FROM sessions WHERE member_id=? AND auth_version<>(SELECT auth_version FROM members WHERE id=?)').bind(me.id,me.id),
        grant.statement,
      ]);
      if(!result[0].meta.changes||!result[2].meta.changes)fail(409,'認証情報が変更されました。再度ログインしてください。');
      return json({ok:true},200,{'Set-Cookie':grant.cookie});
    }
    if(action==='answer'&&method==='DELETE'){
      if(me.role!=='participant')fail(403,'オーナーはイベント削除を使用してください。');
      const result=await db().prepare('DELETE FROM members WHERE id=? AND auth_version=?').bind(me.id,me.auth_version).run();if(!result.meta.changes)fail(409,'認証情報が変更されました。再度ログインしてください。');return json({ok:true},200,{'Set-Cookie':cookie(request,eventId,'',0)});
    }
    if(me.role!=='owner')fail(403,'この操作はオーナーのみ利用できます。');
    if(action==='member'&&method==='DELETE'){
      const data=await body(request);await db().prepare('DELETE FROM members WHERE id=? AND event_id=? AND role=\'participant\' AND EXISTS(SELECT 1 FROM members owner WHERE owner.id=? AND owner.auth_version=?)').bind(data.memberId,eventId,me.id,me.auth_version).run();return json({ok:true});
    }
    if(parts.length===2&&method==='DELETE'){
      const data=await body(request);if(!await verifyPassword(data.password,me.password))fail(401,'パスワードを確認してください。');
      const result=await db().prepare('DELETE FROM events WHERE id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND auth_version=?)').bind(eventId,me.id,me.auth_version).run();if(!result.meta.changes)fail(409,'認証情報が変更されました。再度ログインしてください。');return json({ok:true},200,{'Set-Cookie':cookie(request,eventId,'',0)});
    }
    if(parts.length===2&&method==='PATCH'){
      const data=await body(request);if(Object.hasOwn(data,'timeZone')&&data.timeZone!==event.timeZone)fail(400,'候補のタイムゾーンは作成後に変更できません。');const title=text(data.title,80,true),description=text(data.description,500);const state=data.status;
      if(!['open','closed','confirmed'].includes(state))fail(400,'受付状態を確認してください。');
      let confirmed:string|null=null;
      if(state==='confirmed'){
        if(typeof data.confirmed!=='string')fail(400,'確定日時を選んでください。');
        const [date,startText]=data.confirmed.split('@');const start=Number(startText);const day=event.dates.find(d=>d.date===date);
        if(!Number.isInteger(start)||!day||!Array.from({length:event.duration/30},(_,i)=>start+i).every(s=>day.slots.includes(s)))fail(400,'候補内の連続した時間帯を選んでください。');
        confirmed=data.confirmed;
      }
      const result=await db().prepare('UPDATE events SET title=?,description=?,status=?,confirmed=?,revision=revision+1 WHERE id=? AND revision=? AND expires_at>? AND EXISTS(SELECT 1 FROM members WHERE id=? AND auth_version=?)').bind(title,description,state,confirmed,eventId,data.revision,Date.now(),me.id,me.auth_version).run();
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
