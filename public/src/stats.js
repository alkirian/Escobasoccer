// Récords locales: lo único que el juego recuerda entre sesiones.
// La racha es el mecanismo de "una más y me voy" — por eso vive acá y se
// muestra en la pantalla de fin, no escondida en un menú.
//
// Solo cuentan partidos reales: ni práctica, ni modo espectador (?bots).
const KEY = 'escoba.stats.v1';

const FRESH = {
  v: 1,
  wins: 0, losses: 0, ties: 0,
  streak: 0,          // racha de victorias actual (se corta al perder)
  bestStreak: 0,
  goalsFor: 0, goalsAgainst: 0,
  biggestWin: 0,      // mayor diferencia de gol en una victoria
  runners: 0,         // orbes fugitivos atrapados (histórico)
};

export function loadStats() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...FRESH };
    const s = JSON.parse(raw);
    return { ...FRESH, ...s };
  } catch { return { ...FRESH }; }
}

export function saveStats(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin storage */ }
}

// ¿Primera partida de la vida en este navegador? Decide el arranque suave
// (90 s en fácil): que la primera experiencia sea ganar.
export function isFirstEver() {
  const s = loadStats();
  return s.wins + s.losses + s.ties === 0;
}

// Registra un partido terminado y devuelve qué mostrar en la pantalla de
// fin: la racha y qué récords se acaban de romper.
export function recordMatch({ winner, scoreFor, scoreAgainst }) {
  const s = loadStats();
  let newBestStreak = false;
  let newBiggestWin = false;

  s.goalsFor += scoreFor;
  s.goalsAgainst += scoreAgainst;

  if (winner === 'p1') {
    s.wins++;
    s.streak++;
    if (s.streak > s.bestStreak) { s.bestStreak = s.streak; newBestStreak = s.bestStreak > 1; }
    const diff = scoreFor - scoreAgainst;
    if (diff > s.biggestWin) { s.biggestWin = diff; newBiggestWin = s.biggestWin > 1; }
  } else if (winner === 'p2') {
    s.losses++;
    s.streak = 0;
  } else {
    s.ties++;
  }

  saveStats(s);
  return {
    wins: s.wins, losses: s.losses,
    streak: s.streak, bestStreak: s.bestStreak,
    newBestStreak, newBiggestWin,
  };
}

export function recordRunnerCatch() {
  const s = loadStats();
  s.runners++;
  saveStats(s);
}
