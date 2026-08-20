// Capa única de persistencia. Todo el juego guarda y lee por acá — nunca
// tocando localStorage directo — porque en un portal (iframe de terceros,
// cookies bloqueadas, modo incógnito) localStorage puede LANZAR con solo
// nombrarlo. Si eso pasa, se degrada a un Map en memoria: se juega igual,
// solo que sin progreso persistente. El gameplay nunca debe fallar por
// culpa del guardado.
//
// La API es de strings (como localStorage): los módulos siguen haciendo su
// propio JSON.parse/stringify, así la migración fue mecánica y el formato
// guardado no cambió — el progreso previo de los jugadores se conserva.

const mem = new Map();

// Un solo intento de detección: si localStorage explota al primer uso real,
// no se vuelve a intentar en toda la sesión.
let backend = null;
function _backend() {
  if (backend) return backend;
  try {
    const probe = '__escoba_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    backend = 'local';
  } catch {
    backend = 'mem';
  }
  return backend;
}

export const Storage = {
  get(key) {
    try {
      if (_backend() === 'local') return localStorage.getItem(key);
    } catch { /* cae a memoria */ }
    return mem.has(key) ? mem.get(key) : null;
  },

  set(key, value) {
    const v = String(value);
    try {
      if (_backend() === 'local') { localStorage.setItem(key, v); return; }
    } catch { /* cae a memoria */ }
    mem.set(key, v);
  },

  remove(key) {
    try {
      if (_backend() === 'local') { localStorage.removeItem(key); }
    } catch { /* nada */ }
    mem.delete(key);
  },
};
