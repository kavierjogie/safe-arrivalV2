// Translation-ready structure. English ships for the MVP; adding a language means
// adding a dictionary here (and in the WhatsApp engine's message table).
import en from './en'

export const LANGUAGES = [
  { code: 'en', label: 'English', ready: true },
  { code: 'fr', label: 'Français', ready: false },
  { code: 'de', label: 'Deutsch', ready: false },
  { code: 'es', label: 'Español', ready: false },
  { code: 'zh', label: '中文', ready: false },
]
const DICTS = { en }

export function getLanguage() {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem('sa-lang')
  return DICTS[saved] ? saved : 'en'
}
export function setLanguage(code) {
  if (DICTS[code]) { localStorage.setItem('sa-lang', code); location.reload() }
}
/** t('trip.somethingWrong') → falls back to English, then to the key. */
export function t(key, lang = getLanguage()) {
  return DICTS[lang]?.[key] ?? en[key] ?? key
}
