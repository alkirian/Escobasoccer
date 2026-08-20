// Fachada de plataforma: TODO lo que el juego necesita del "mundo exterior"
// (portal, navegador, guardado, idioma, ciclo de vida) pasa por acá. El core
// (main.js, match.js, render.js...) llama Platform.* y jamás un SDK directo.
//
// Para Basic Launch de CrazyGames el backend del portal es un fallback local
// (no exige SDK); cuando llegue la integración completa, se implementa en
// crazygames.js sin tocar el resto del juego.
import { BUILD_CONFIG } from '../build_config.js';
import { StandalonePlatform } from './standalone.js';
import { CrazyGamesPlatform } from './crazygames.js';

const impl = BUILD_CONFIG.platform === 'crazygames'
  ? CrazyGamesPlatform
  : StandalonePlatform;

export const Platform = {
  // Arranque de página. Devuelve una promesa por si un SDK futuro necesita
  // inicialización asíncrona; hoy resuelve al instante.
  init() { return impl.init?.() ?? Promise.resolve(); },

  // El partido empezó / terminó de verdad (gameplay, no menús). Los portales
  // usan estas señales para métricas y para pausar sus propios overlays.
  gameplayStart() { impl.gameplayStart?.(); },
  gameplayStop() { impl.gameplayStop?.(); },

  // El juego quedó en pausa / se reanudó (pantalla de pausa, pérdida de foco).
  pause() { impl.pause?.(); },
  resume() { impl.resume?.(); },

  // Idioma que la plataforma conoce (o null si no aporta ninguno). El sistema
  // de i18n lo consulta como segundo eslabón de la cadena de resolución.
  getLocale() { return impl.getLocale?.() ?? null; },

  // Persistencia con nombre de plataforma. Hoy delega en Storage local;
  // mañana puede ser Cloud Data sin que el core lo note.
  save(key, value) { return impl.save(key, value); },
  load(key) { return impl.load(key); },
};
