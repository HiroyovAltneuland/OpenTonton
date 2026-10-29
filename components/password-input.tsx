'use client';
import {useState} from 'react';
import {useLanguage} from './language-provider';
import {generatePassword} from '../lib/registration';
export function PasswordInput({value,onChange,onCopy,label,required=true}:{value:string;onChange:(value:string)=>void;onCopy:(value:string)=>void;label:string;required?:boolean}){
 const {t}=useLanguage();const [visible,setVisible]=useState(false);
 return <div className="password-tools"><input aria-label={label} type={visible?'text':'password'} required={required} minLength={10} maxLength={128} autoComplete="new-password" spellCheck={false} autoCapitalize="none" value={value} onChange={e=>onChange(e.target.value)}/><div className="password-buttons"><button type="button" className="secondary" onClick={()=>onChange(generatePassword())}>{t('安全なパスワードを作る')}</button><button type="button" className="secondary" aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?t('隠す'):t('表示')}</button><button type="button" className="secondary" disabled={!value} onClick={()=>onCopy(value)}>{t('コピー')}</button></div><p className="field-hint">{t('自分で入力することもできます。ブラウザやパスワード管理アプリに保存してください。')}</p></div>;
}
