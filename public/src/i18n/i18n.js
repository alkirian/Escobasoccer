// Internacionalización. Todo texto visible por el jugador sale de acá vía
// t('clave'), con diccionarios completos en inglés (en.js) y español (es.js).
//
// Resolución del idioma, en orden:
//   1. elección manual del jugador (Opciones → Idioma, persistida)
//   2. locale de la plataforma (Platform.getLocale — el SDK del portal,
//      cuando exista; hoy devuelve null)
//   3. navigator.language
//   4. inglés
// Con locale presente (de plataforma o navegador): es* → español; cualquier
// otro → inglés. Así CrazyGames abre el juego en inglés sin tocar nada.
//
// Inglés es además el fallback por clave: si a es.js le falta una entrada,
// se muestra la inglesa antes que la clave pelada.
import { Platform } from '../platform/platform.js';
import { Storage } from '../storage/storage.js';
import { EN } from './en.js';
import { ES } from './es.js';

const LANG_KEY = 'escoba.lang.v1';
const LANGS = { en: EN, es: ES };

function fromLocale(loc) {
  return String(loc || '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

function resolve() {
  const manual = Storage.get(LANG_KEY);
  if (manual && LANGS[manual]) return manual;
  const platform = Platform.getLocale();
  if (platform) return fromLocale(platform);
  if (navigator.language) return fromLocale(navigator.language);
  return 'en';
}

let lang = resolve();

export function getLang() { return lang; }

// 'en' | 'es' | null (null = volver al automático)
export function setLang(l) {
  if (l && LANGS[l]) { Storage.set(LANG_KEY, l); lang = l; }
  else { Storage.remove(LANG_KEY); lang = resolve(); }
}

// ¿Hay elección manual guardada? (para pintar el selector de Opciones)
export function manualLang() {
  const m = Storage.get(LANG_KEY);
  return m && LANGS[m] ? m : null;
}

// t('clave') o t('clave', { n: 3 }) con {n} en el texto.
export function t(key, params) {
  let s = LANGS[lang][key] ?? EN[key] ?? key;
  if (params) {
    for (const k in params) s = s.split(`{${k}}`).join(params[k]);
  }
  return s;
}

// Traduce el DOM estático de una página: todo elemento con data-i18n usa su
// clave como textContent; data-i18n-html permite claves con marcado simple
// (solo para textos NUESTROS de los diccionarios, nunca datos del usuario).
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  }
  document.documentElement.lang = lang;
}
