import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Language } from '@shared/types'
import { en, zh, type TranslationKey } from './translations'

const dictionaries: Record<Language, Record<TranslationKey, string>> = { zh, en }

interface I18nValue {
  language: Language
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue>({
  language: 'zh',
  t: (key) => key
})

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    return {
      language,
      t: (key, vars) => {
        let text = dictionaries[language][key] ?? dictionaries.zh[key] ?? String(key)
        if (vars) {
          for (const [name, replacement] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(replacement))
          }
        }
        return text
      }
    }
  }, [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): I18nValue {
  return useContext(I18nContext)
}

export type { TranslationKey }
