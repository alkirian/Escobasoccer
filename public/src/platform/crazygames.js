// Plataforma CrazyGames.
//
// Dos modos, elegidos por BUILD_CONFIG.sdk:
//
//   sdk: false  (Basic Launch — lo que se sube hoy)
//     Ningún script externo, ninguna llamada al SDK. Guarda local, el idioma
//     lo decide navigator.language y las señales de gameplay son no-ops.
//     Basic Launch NO exige el SDK y el portal rechaza cargas externas
//     innecesarias, así que en este modo el archivo de CrazyGames ni se pide.
//
//   sdk: true   (Full Launch)
//     Carga el SDK v3, lo inicializa y a partir de ahí gameplayStart/Stop,
//     locale y guardado pasan por él.
//
// Lo importante: el core del juego llama Platform.* y NUNCA window.CrazyGames.
// Pasar de Basic a Full es cambiar el flag y probar; no se toca el gameplay.
//
// Todas las llamadas al SDK van envueltas: si el jugador tiene AdBlock, si el
// script no carga o si el portal cambia la API, el juego sigue funcionando con
// el comportamiento local. Un juego que se rompe por AdBlock es rechazo directo
// en la QA de CrazyGames.
import { BUILD_CONFIG } from '../build_config.js';
import { Storage } from '../storage/storage.js';

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

let sdk = null;             // window.CrazyGames.SDK una vez inicializado
let initPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('SDK no disponible'));
    document.head.appendChild(s);
  });
}

async function boot() {
  if (!BUILD_CONFIG.sdk) return null;
  try {
    if (!window.CrazyGames?.SDK) await loadScript(SDK_URL);
    const s = window.CrazyGames?.SDK;
    if (!s) return null;
    await s.init();
    return s;
  } catch (e) {
    // AdBlock, red caída, dominio bloqueado: se juega igual, sin portal.
    console.warn('[CrazyGames] SDK no disponible; modo local.', e?.message || e);
    return null;
  }
}

// Envoltorio para cualquier llamada al SDK: nunca puede tumbar un frame.
function safe(fn) {
  try { if (sdk) fn(sdk); } catch (e) { /* el gameplay manda */ }
}

export const CrazyGamesPlatform = {
  init() {
    if (!initPromise) initPromise = boot().then((s) => { sdk = s; return s; });
    return initPromise;
  },

  gameplayStart() { safe((s) => s.game.gameplayStart()); },
  gameplayStop() { safe((s) => s.game.gameplayStop()); },

  // El portal muestra sus propios overlays; avisarle de la pausa evita que
  // cuente como tiempo jugado. Con SDK apagado es un no-op.
  pause() { safe((s) => s.game.gameplayStop()); },
  resume() { /* el reanudar real lo emite el flanco de gameplayStart */ },

  // Sin SDK devuelve null y el i18n cae a navigator.language (inglés por
  // defecto para cualquier locale no español), que es exactamente lo que
  // CrazyGames pide como fallback.
  getLocale() {
    let loc = null;
    safe((s) => { loc = s.user?.systemInfo?.countryCode ? s.game?.locale ?? null : null; });
    return loc;
  },

  // Guardado: local en Basic. En Full, el Data module del SDK es un reemplazo
  // directo de estas dos funciones (misma API de strings) — por eso Storage
  // expone get/set y nada más.
  save(key, value) { Storage.set(key, value); },
  load(key) { return Storage.get(key); },
};
