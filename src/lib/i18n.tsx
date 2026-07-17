import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { MESSAGES, type Lang } from './locales'

const LANG_KEY = 'options-lab-lang'

interface I18n {
  lang: Lang
  setLang: (l: Lang) => void
  /** UI string by key, with {var} substitution */
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Localized strategy/position name (falls back to the English name) */
  tStrat: (name: string) => string
  /** Localized preset hint by preset key (falls back to the English hint) */
  tHint: (presetKey: string, fallback: string) => string
}

const I18nContext = createContext<I18n | null>(null)

function substitute(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY)
    return saved === 'zh-CN' || saved === 'zh-TW' || saved === 'en' ? saved : 'en'
  })

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      substitute(MESSAGES[lang].ui[key] ?? MESSAGES.en.ui[key] ?? key, vars),
    [lang],
  )
  const tStrat = useCallback(
    (name: string) => {
      // "Custom · 3 legs" carries a count — translate the prefix pattern
      const custom = /^Custom · (\d+) legs$/.exec(name)
      if (custom) {
        if (lang === 'zh-CN') return `自定义 · ${custom[1]} 腿`
        if (lang === 'zh-TW') return `自訂 · ${custom[1]} 腿`
        return name
      }
      return MESSAGES[lang].strategies[name] ?? name
    },
    [lang],
  )
  const tHint = useCallback(
    (presetKey: string, fallback: string) => MESSAGES[lang].hints[presetKey] ?? fallback,
    [lang],
  )

  const value = useMemo(
    () => ({ lang, setLang, t, tStrat, tHint }),
    [lang, t, tStrat, tHint],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
