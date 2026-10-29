/** 24 independently sampled base64url characters: 144 random bits. Never persisted here. */
export function generatePassword():string {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 return Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>alphabet[byte&63]).join('');
}
export function participantSuggestion(names:string[],next=1,language='ja'):string {
 const prefix=language==='en'?'Participant ':'参加者';let number=Math.max(1,next);
 while(names.includes(prefix+number))number++;
 return prefix+number;
}
