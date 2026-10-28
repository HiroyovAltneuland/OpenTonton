export function securityPolicy(nonce:string){
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}
export function secureResponse(response:Response,policy:string){
  const headers=new Headers(response.headers);
  headers.set('Content-Security-Policy',policy);
  headers.set('X-Frame-Options','DENY');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security','max-age=31536000');
  if(headers.get('content-type')?.includes('text/html'))headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
const error=(message:string,status:number,retry?:number)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store',...(retry?{'Retry-After':String(retry)}:{})}});
export async function admitApiRequest(request:Request,env:Cloudflare.Env):Promise<Response|null>{
  const url=new URL(request.url);const path=url.pathname;const method=request.method;
  if(!path.startsWith('/api/'))return null;
  const event='/api/events/[a-f0-9]{32}';
  const valid=method==='GET'?new RegExp(`^${event}$`).test(path):
    method==='POST'?(path==='/api/events'||new RegExp(`^${event}/(credentials|login|recover|join|logout)$`).test(path)):
    method==='PATCH'?new RegExp(`^${event}(/(answer|profile))?$`).test(path):
    method==='DELETE'?new RegExp(`^${event}(/(answer|member))?$`).test(path):false;
  if(!valid)return error('操作が見つかりません。',404);
  if(method!=='GET'){
    if(request.headers.get('origin')!==url.origin)return error('同じサイトから操作してください。',403);
    if(!request.headers.get('content-type')?.includes('application/json'))return error('JSON形式で送信してください。',415);
    if(Number(request.headers.get('content-length')||0)>64000)return error('入力内容が大きすぎます。',413);
  }
  const read=method==='GET';
  const perAddress=read?env.API_READ_LIMIT:env.API_WRITE_LIMIT;
  const global=read?env.GLOBAL_READ_LIMIT:env.GLOBAL_WRITE_LIMIT;
  if(!perAddress||!global||!env.CREATE_LIMIT)return error('アクセス保護の設定を確認しています。時間をおいてお試しください。',503,60);
  // Do not put raw addresses or bearer event URLs in limiter keys.
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${Math.floor(Date.now()/60000)}:${request.headers.get('cf-connecting-ip')||'local'}`)));
  const key=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  const retry=Math.max(1,Math.ceil((60000-Date.now()%60000)/1000));
  if(!(await perAddress.limit({key})).success)return error('アクセスが集中しています。少し時間をおいてお試しください。',429,retry);
  if(path==='/api/events'&&method==='POST'&&!(await env.CREATE_LIMIT.limit({key})).success)return error('作成リクエストが1分間の上限（10回）に達しました。少し時間をおいてお試しください。',429,retry);
  if(!(await global.limit({key:read?'all-read':'all-write'})).success)return error('サービスへのアクセスが集中しています。少し時間をおいてお試しください。',429,retry);
  return null;
}
