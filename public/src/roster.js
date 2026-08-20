// Roster de producción: 5 personajes desbloqueados de entrada, el resto se
// compra con monedas ganadas jugando.
//
// Los 5 iniciales cubren las cinco fantasías básicas — el estándar (Aldus),
// el brujo oscuro (Mordrak), el velocista (Zefir), la atacante (Valka) y la
// tanque (Petra). Así el jugador nuevo ya prueba estilos bien distintos, y
// los bloqueados son variaciones más finas que dan ganas de coleccionar.
//
// Las monedas se ganan al terminar partidos reales (ni práctica ni ?bots):
// ganar paga más que perder, y cada gol suma — perder 3-4 igual deja algo.

const KEY = 'escoba.roster.v1';

export const STARTERS = ['mago', 'mordrak', 'zefir', 'valka', 'petra'];

// Precio de cada bloqueado. Escalonados: los primeros desbloqueos llegan
// rápido (enganchan), el último es el trofeo de constancia.
export const COSTS = {
  izar:     250,
  vendaval: 250,
  hilaria:  350,
  silvano:  350,
  fogon:    500,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { coins: 0, unlocked: [] };
    const d = JSON.parse(raw);
    return { coins: d.coins | 0, unlocked: Array.isArray(d.unlocked) ? d.unlocked : [] };
  } catch { return { coins: 0, unlocked: [] }; }
}

function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* sin storage */ }
}

export function isUnlocked(id) {
  if (STARTERS.includes(id)) return true;
  return load().unlocked.includes(id);
}

export function coins() { return load().coins; }

export function addCoins(n) {
  const d = load();
  d.coins = Math.max(0, d.coins + (n | 0));
  save(d);
  return d.coins;
}

// Intenta comprar un personaje. Devuelve true si lo desbloqueó.
export function tryUnlock(id) {
  if (isUnlocked(id)) return true;
  const cost = COSTS[id];
  if (cost == null) return false;
  const d = load();
  if (d.coins < cost) return false;
  d.coins -= cost;
  d.unlocked.push(id);
  save(d);
  return true;
}

// Recompensa por partido. `golesFavor` endulza incluso la derrota.
export function matchReward({ win, golesFavor = 0, campeon = false }) {
  let n = (win ? 40 : 10) + golesFavor * 5;
  if (campeon) n += 100;
  addCoins(n);
  return n;
}
