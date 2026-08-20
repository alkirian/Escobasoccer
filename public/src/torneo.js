// Camino al Campeonato: cinco rivales seguidos, dificultad creciente.
// Perdés → reintentás la misma ronda. Ganás las cinco → trofeo permanente.
// Le da al juego una sesión con principio, tensión y final — y una razón
// para volver: el trofeo que quedó a medias.
//
// El progreso vive en localStorage; la página de preparación muestra el
// bracket y play.html lee de acá qué ronda toca (sin params frágiles).

import { Storage } from './storage/storage.js';
export const RONDAS = [
  {
    rival: 'zefir', nombre: 'Zefir el Vientoveloz',
    dificultad: 'facil', duracion: 90,
    frase: 'El correo del reino te toma de sparring. No pestañees.',
  },
  {
    rival: 'valka', nombre: 'Valka la Escudera',
    dificultad: 'facil', duracion: 120,
    frase: 'Golpea primero y pregunta después. Casi siempre golpea primero.',
  },
  {
    rival: 'izar', nombre: 'Ízar el Elemental',
    dificultad: 'normal', duracion: 120,
    frase: 'Fuego de un lado, hielo del otro. Vos, en el medio.',
  },
  {
    rival: 'mordrak', nombre: 'Mordrak del Pantano',
    dificultad: 'normal', goles: 3,
    frase: 'Partido a 3 goles. Su arco está maldito — probá meterle uno.',
  },
  {
    rival: 'mago', nombre: 'Aldus el Errante',
    dificultad: 'dificil', duracion: 150, final: true,
    frase: 'El primero en subirse a una escoba. Nadie le ganó todavía.',
  },
];

const KEY = 'escoba.torneo.v1';

const FRESH = {
  ronda: 0,          // 0..4: ronda que toca jugar
  mejorRonda: 0,     // ronda más alta alcanzada (histórico)
  campeonatos: 0,    // veces que se completó el camino entero
};

export function loadTorneo() {
  try {
    const raw = Storage.get(KEY);
    return raw ? { ...FRESH, ...JSON.parse(raw) } : { ...FRESH };
  } catch { return { ...FRESH }; }
}

function save(t) {
  try { Storage.set(KEY, JSON.stringify(t)); } catch { /* nada */ }
}

// La ronda que corresponde jugar ahora (config completa).
export function rondaActual() {
  const t = loadTorneo();
  return { indice: t.ronda, cfg: RONDAS[Math.min(t.ronda, RONDAS.length - 1)] };
}

// Victoria en la ronda actual. Devuelve { campeon, proximaRonda }.
export function torneoWin() {
  const t = loadTorneo();
  t.ronda++;
  t.mejorRonda = Math.max(t.mejorRonda, t.ronda);
  let campeon = false;
  if (t.ronda >= RONDAS.length) {
    campeon = true;
    t.campeonatos++;
    t.ronda = 0;         // el camino vuelve a empezar, el trofeo queda
  }
  save(t);
  return { campeon, proximaRonda: t.ronda };
}

// Derrota: se queda en la misma ronda (reintentar es parte del diseño).
export function torneoLose() {
  return loadTorneo().ronda;
}

// Abandonar y arrancar de cero (lo ofrece la pantalla de preparación).
export function resetTorneo() {
  const t = loadTorneo();
  t.ronda = 0;
  save(t);
}
