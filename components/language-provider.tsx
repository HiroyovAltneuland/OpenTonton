'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initialLanguage, LANGUAGE_STORAGE_KEY, translate, formatDate, formatStamp, type Language } from '../lib/i18n';
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: 'ja', setLanguage: () => {} });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('ja');
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
    setLanguage(initialLanguage(saved, navigator.language));
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'ja' ? 'OpenTonton — みんなの都合を、ひとつに。' : 'OpenTonton — Find a time. Bring everyone together.';
  }, [language]);
  const changeLanguage = (value: Language) => {
    setLanguage(value);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, value); } catch { /* Switching still works without storage. */ }
  };
  return <LanguageContext.Provider value={{ language, setLanguage: changeLanguage }}>{children}</LanguageContext.Provider>;
}
export function useLanguage() {
  const context = useContext(LanguageContext);
  return {
    ...context,
    t: (message: string, values?: Array<string | number>) => translate(context.language, message, values),
    dateFormat: (date: string, options?: Intl.DateTimeFormatOptions) => formatDate(date, context.language, options),
    stamp: (value: number) => formatStamp(value, context.language),
  };
}
