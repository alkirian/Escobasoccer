// Plataforma standalone: la web propia. Sin portal, sin SDK — todo local.
import { Storage } from '../storage/storage.js';

export const StandalonePlatform = {
  init() { return Promise.resolve(); },
  gameplayStart() { /* sin portal que avisar */ },
  gameplayStop() { /* sin portal que avisar */ },
  pause() { /* nada extra */ },
  resume() { /* nada extra */ },
  getLocale() { return null; },   // standalone no aporta idioma propio
  save(key, value) { Storage.set(key, value); },
  load(key) { return Storage.get(key); },
};
