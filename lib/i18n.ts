import translations from './translations.json' with { type: 'json' };
const english: Record<string, string> = translations;
export type Language = 'ja' | 'en';
export const LANGUAGE_STORAGE_KEY = 'ot_language';
export function initialLanguage(saved: string | null, browserLanguage: string): Language {
  return saved === 'ja' || saved === 'en' ? saved : /^ja(?:-|$)/i.test(browserLanguage) ? 'ja' : 'en';
}
export function translate(language: Language, message: string, values: Array<string | number> = []): string {
  const text = language === 'en' && Object.hasOwn(english, message) ? english[message] : message;
  return text.replace(/\{(\d+)\}/g, (token, index) => String(values[Number(index)] ?? token));
}
// API messages remain compatible with older clients. Match only known errors;
// never apply this function to titles, descriptions, nicknames, or credentials.
export function translateError(language: Language, message: string): string {
  if (language === 'ja') return message;
  if (Object.hasOwn(english, message)) return english[message];
  const max = /^入力内容を確認してください（最大(\d+)文字）。$/.exec(message);
  if (max) return translate(language, '入力内容を確認してください（最大{0}文字）。', [max[1]]);
  const code = /^処理できませんでした。エラーコード：(OT_[A-Z0-9_]+)$/.exec(message);
  if (code) return translate(language, '処理できませんでした。エラーコード：{0}', [code[1]]);
  return 'Unable to complete the operation. Please try again.';
}
export function formatDate(date: string, language: Language, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'short' }): string {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', { ...options, ...(language === 'en' && options.month === 'numeric' ? { month: 'short' as const } : {}), timeZone: 'Asia/Tokyo' }).format(new Date(date + 'T12:00:00+09:00'));
}
export function formatStamp(value: number, language: Language): string {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: language === 'ja' ? 'numeric' : 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }).format(value);
}
