// Desafíos locales: objetivos con recompensa cosmética. Son la razón
// estructural para "un partido más": cada uno pide jugar distinto (defender
// perfecto, cazar al fugitivo, cargar el tiro de fuego) y las paletas
// desbloqueadas convierten el plantel en progresión.
//
// Todo vive en localStorage — sin cuentas, sin servidor.
import { Storage } from './storage/storage.js';
const KEY = 'escoba.challenges.v1';

// `palette` = recompensa: { char, id, nombre }. Sin palette → medalla.
export const CHALLENGES = [
  {
    id: 'primera', icono: '🏅', titulo: 'Primera sangre',
    desc: 'Ganá tu primer partido',
  },
  {
    id: 'muralla', icono: '🛡️', titulo: 'La Muralla',
    desc: 'Ganá un partido sin recibir goles',
    palette: { char: 'valka', id: 'nocturna', nombre: 'Valka Nocturna' },
  },
  {
    id: 'piromania', icono: '🔥', titulo: 'Piromanía',
    desc: 'Meté un gol con un tiro de fuego (golpe con media barra o más)',
    palette: { char: 'izar', id: 'inverso', nombre: 'Ízar Inverso' },
  },
  {
    id: 'cazador', icono: '✨', titulo: 'Cazador de fugitivos',
    desc: 'Atrapá al orbe dorado 3 veces',
    palette: { char: 'zefir', id: 'escarlata', nombre: 'Zefir Escarlata' },
  },
  {
    id: 'imparable', icono: '⚡', titulo: 'Imparable',
    desc: 'Ganá 3 partidos seguidos',
    palette: { char: 'mordrak', id: 'espectro', nombre: 'Mordrak Espectro' },
  },
  {
    id: 'goleada', icono: '💥', titulo: 'Aplastante',
    desc: 'Ganá por 3 o más goles de diferencia',
  },
  {
    id: 'leyenda', icono: '👑', titulo: 'Leyenda',
    desc: 'Ganale a un rival en dificultad difícil',
  },

  // ── Tanda 2: primer croma para los 6 que todavía no tenían ninguno ────
  {
    id: 'aguante', icono: '🪨', titulo: 'Aguante',
    desc: 'Ganá 5 partidos en modo 2 vs 2',
    palette: { char: 'petra', id: 'fosil', nombre: 'Petra Fósil' },
  },
  {
    id: 'coleccionista', icono: '🧶', titulo: 'Coleccionista',
    desc: 'Atrapá al orbe dorado 10 veces en total',
    palette: { char: 'hilaria', id: 'hilaria_ceniza', nombre: 'Hilaria Ceniza' },
  },
  {
    id: 'abordaje', icono: '⚓', titulo: 'Abordaje',
    desc: 'Metela un gol menos de 1 segundo después de un dash',
    palette: { char: 'vendaval', id: 'vendaval_tormenta', nombre: 'Vendaval Tormenta' },
  },
  {
    id: 'ahorro', icono: '🍂', titulo: 'Sin gastar nada',
    desc: 'Ganá un partido sin usar la propulsión mágica ni un segundo',
    palette: { char: 'silvano', id: 'otonio', nombre: 'Silvano Otoño' },
  },
  {
    id: 'ultimosegundo', icono: '⏱️', titulo: 'Al límite',
    desc: 'Metela un gol con 3 segundos o menos en el reloj',
    palette: { char: 'fogon', id: 'carbon', nombre: 'Fogón Carbón' },
  },
  {
    // Sin paleta a propósito: Aldus (el mago) no vive en el sistema de
    // personajes de characters.js — se dibuja directo en render.js, sin el
    // mecanismo `palettes` que usan los demás héroes. Darle un croma
    // implicaría tocar ese método compartido y arriesgar cómo se ve el mago
    // para TODOS los que lo usan, no sólo agregar un color — queda fuera de
    // esta tanda. Este desafío pasa a dar medalla, como los otros hitos
    // "de veteranía" (imparable, goleada, leyenda).
    id: 'veterano', icono: '🎖️', titulo: 'Veterano',
    desc: 'Ganá 10 partidos en total',
  },

  // ── Tanda 2: segundo croma para los 4 que ya tenían uno ────────────────
  {
    id: 'escuadron', icono: '🤝', titulo: 'Escuadrón',
    desc: 'Ganá un partido de 2 vs 2 sin recibir goles',
    palette: { char: 'valka', id: 'solar', nombre: 'Valka Solar' },
  },
  {
    id: 'equilibrio', icono: '☯️', titulo: 'Equilibrio perfecto',
    desc: 'Metela un gol con tiro de fuego en un 2 vs 2',
    palette: { char: 'izar', id: 'equilibrio', nombre: 'Ízar Equilibrio' },
  },
  {
    id: 'reflejos', icono: '🌀', titulo: 'Reflejos',
    desc: 'Atrapá al orbe dorado antes de que pasen 3 segundos desde que aparece',
    palette: { char: 'zefir', id: 'zefir_tormenta', nombre: 'Zefir Tormenta' },
  },
  {
    id: 'paciencia', icono: '⏳', titulo: 'Paciencia infinita',
    desc: 'Ganá un partido sin usar el dash ni una sola vez',
    palette: { char: 'mordrak', id: 'mordrak_ceniza', nombre: 'Mordrak Ceniza' },
  },
];

function load() {
  try {
    const raw = Storage.get(KEY);
    return raw ? JSON.parse(raw) : { done: {} };
  } catch { return { done: {} }; }
}

function save(st) {
  try { Storage.set(KEY, JSON.stringify(st)); } catch { /* nada */ }
}

export function isDone(id) {
  return !!load().done[id];
}

// Marca un desafío como cumplido. Devuelve la definición SOLO si es nuevo
// (para el aviso en pantalla); si ya estaba hecho, null — así el que llama
// puede empujar avisos sin filtrar nada.
export function completeChallenge(id) {
  const st = load();
  if (st.done[id]) return null;
  const def = CHALLENGES.find((c) => c.id === id);
  if (!def) return null;
  st.done[id] = Date.now();
  save(st);
  return def;
}

// Paletas alternativas desbloqueadas para un personaje.
export function unlockedPalettes(charId) {
  const st = load();
  return CHALLENGES
    .filter((c) => c.palette && c.palette.char === charId && st.done[c.id])
    .map((c) => c.palette);
}

// ── Selección de paleta por personaje ─────────────────────────────────────
const PALETTE_KEY = 'escoba.palette.v1';

export function selectedPalettes() {
  try { return JSON.parse(Storage.get(PALETTE_KEY) || '{}'); }
  catch { return {}; }
}

export function selectPalette(charId, paletteId) {
  const map = selectedPalettes();
  if (paletteId) map[charId] = paletteId;
  else delete map[charId];
  try { Storage.set(PALETTE_KEY, JSON.stringify(map)); } catch { /* nada */ }
}
