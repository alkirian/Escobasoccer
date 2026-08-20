// Plataforma CrazyGames — versión Basic Launch: comportamiento local.
//
// Basic Launch NO exige el SDK, así que este backend es deliberadamente un
// fallback: guarda local, no aporta locale (el i18n cae a navigator.language)
// y las señales de gameplay/pausa son puntos de enganche vacíos.
//
// Cuando el juego pase a Full Launch, la integración del SDK v3 vive ACÁ:
//   - init(): cargar el SDK y esperar window.CrazyGames.SDK
//   - gameplayStart/Stop(): SDK.game.gameplayStart()/gameplayStop()
//   - getLocale(): SDK.user o SDK.game según la versión
//   - save/load: Cloud Data
// El resto del juego no se toca — solo llama Platform.*.
import { Storage } from '../storage/storage.js';

export const CrazyGamesPlatform = {
  init() { return Promise.resolve(); },
  gameplayStart() { /* punto de enganche para SDK.game.gameplayStart() */ },
  gameplayStop() { /* punto de enganche para SDK.game.gameplayStop() */ },
  pause() { /* punto de enganche para overlays del portal */ },
  resume() { /* punto de enganche para overlays del portal */ },
  getLocale() { return null; },   // sin SDK todavía: decide navigator.language
  save(key, value) { Storage.set(key, value); },
  load(key) { return Storage.get(key); },
};
