// Expensive password stretching runs on the user's device, outside Workers'
// PBKDF2/CPU limits. This module must never be used to stretch inside a Worker.
export const PASSWORD_SCHEME='client-pbkdf2-sha256-v1';
export const PASSWORD_ITERATIONS=600000;
export type PasswordProof={scheme:typeof PASSWORD_SCHEME;salt:string;verifier:string};
export type CredentialParameters={scheme:typeof PASSWORD_SCHEME;salt:string};
const encoder=new TextEncoder();
const hex=(bytes:Uint8Array)=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
export const randomPasswordSalt=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
export function validPasswordProof(value:unknown):value is PasswordProof {
  if(!value||typeof value!=='object')return false;
  const proof=value as Partial<PasswordProof>;
  return proof.scheme===PASSWORD_SCHEME&&typeof proof.salt==='string'&&/^[a-f0-9]{32}$/.test(proof.salt)&&typeof proof.verifier==='string'&&/^[a-f0-9]{64}$/.test(proof.verifier);
}
export async function stretchPassword(password:unknown,salt=randomPasswordSalt()):Promise<PasswordProof>{
  if(typeof password!=='string'||password.length<10||password.length>128)throw new Error('パスワードは10〜128文字で設定してください。');
  if(!/^[a-f0-9]{32}$/.test(salt))throw new Error('認証情報を取得できませんでした。画面を再読み込みしてください。');
  if(!globalThis.crypto?.subtle)throw new Error('安全な接続（HTTPS）で開いてください。');
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:PASSWORD_ITERATIONS,salt:encoder.encode(`OpenTonton credential v1:${salt}`)},key,256);
  return {scheme:PASSWORD_SCHEME,salt,verifier:hex(new Uint8Array(bits))};
}
type Sender=(path:string,method:string,body?:unknown)=>Promise<any>;
export async function preparePasswordBody(path:string,method:string,body:unknown,send:Sender):Promise<unknown>{
  if(!body||typeof body!=='object'||Array.isArray(body))return body;
  const data={...body} as Record<string,unknown>;
  const parts=path.split('/').filter(Boolean);const action=parts[1];
  const registering=method==='POST'&&(parts.length===0||action==='join'||action==='recover');
  const authenticating=(method==='POST'&&action==='login')||(method==='PATCH'&&action==='profile')||(method==='DELETE'&&parts.length===1);
  if(authenticating){
    const parameters=await send(`/${parts[0]}/credentials`,'POST',action==='login'?{nickname:data.nickname}:{self:true}) as CredentialParameters;
    if(parameters.scheme!==PASSWORD_SCHEME||typeof parameters.salt!=='string')throw new Error('認証形式が更新されています。画面を再読み込みしてください。');
    const field=action==='profile'?'currentPassword':'password';
    data[field]=await stretchPassword(data[field],parameters.salt);
  }
  if(registering||(method==='PATCH'&&action==='profile'&&data.password))data.password=await stretchPassword(data.password);
  return data;
}
