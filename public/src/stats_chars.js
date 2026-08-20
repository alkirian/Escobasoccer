// Stats por personaje: cada héroe destaca en algo y paga en otra cosa.
//
// Regla dura: TODOS suman 18 puntos repartidos en 5 stats de 1 a 5. Si
// alguien se siente "el bueno", el sistema falló — nadie es mejor, cada uno
// es mejor EN ALGO.
//
// Los stats no son números decorativos: cada uno multiplica una constante
// real de la física. La conversión usa un rango CONSERVADOR (±20% respecto
// del valor base en 3) a propósito: es mucho más fácil subir un rango tímido
// después que arreglar un personaje roto que ya le gustó a la gente.
//
//   1 → 0.80×   2 → 0.90×   3 → 1.00×   4 → 1.10×   5 → 1.20×

export const STAT_IDS = ['vel', 'man', 'fue', 'pes', 'mag'];

export const STAT_INFO = {
  vel: { label: 'Velocidad', icono: '⚡', color: '#3fc0ff',
         desc: 'Qué tan rápido cruzás la cancha' },
  man: { label: 'Maniobra',  icono: '🌀', color: '#7ee8a2',
         desc: 'Qué tan cerrado girás y qué tan rápido respondés' },
  fue: { label: 'Fuerza',    icono: '💥', color: '#ff8a3c',
         desc: 'Qué tan lejos sale la pelota de tu golpe' },
  pes: { label: 'Peso',      icono: '🛡️', color: '#b9c2cf',
         desc: 'Cuánto te mueven los choques y la explosión del gol' },
  mag: { label: 'Magia',     icono: '🔮', color: '#c88aff',
         desc: 'Dash y propulsión: cuánto rinden y cada cuánto' },
};

// vel, man, fue, pes, mag — TODOS suman 15, y cada COLUMNA promedia 3.0.
//
// Por qué 15 y no 18: con 5 stats, 15 puntos es lo único que hace que el
// promedio sea exactamente 3 — o sea, que el "3" sea de verdad el centro.
// Con 18 el promedio real era 3.6, así que casi todos quedaban por encima
// de la base y el juego entero se volvía más fuerte/mágico sin querer.
// Importa que cada COLUMNA promedie 3 tanto como que cada FILA sume 15: si
// todos pegan fuerte y andan lento, la base deja de ser la referencia.
export const STATS = {
  mago:     { vel: 3, man: 3, fue: 3, pes: 3, mag: 3, arq: 'El estándar del juego' },
  valka:    { vel: 3, man: 2, fue: 5, pes: 4, mag: 1, arq: 'Ariete: pega y empuja' },
  mordrak:  { vel: 1, man: 3, fue: 4, pes: 3, mag: 4, arq: 'Brujo lento y cargado' },
  izar:     { vel: 3, man: 3, fue: 5, pes: 1, mag: 3, arq: 'Cañón de cristal' },
  zefir:    { vel: 5, man: 5, fue: 1, pes: 1, mag: 3, arq: 'Puro movimiento' },
  petra:    { vel: 1, man: 1, fue: 4, pes: 5, mag: 4, arq: 'Muralla inamovible' },
  hilaria:  { vel: 2, man: 5, fue: 2, pes: 2, mag: 4, arq: 'Precisión de relojera' },
  vendaval: { vel: 5, man: 3, fue: 3, pes: 3, mag: 1, arq: 'Velocidad con puño' },
  silvano:  { vel: 3, man: 4, fue: 2, pes: 4, mag: 2, arq: 'Sin debilidades' },
  fogon:    { vel: 4, man: 1, fue: 1, pes: 4, mag: 5, arq: 'Bruto de cocina' },
};

const NEUTRAL = { vel: 3, man: 3, fue: 3, pes: 3, mag: 3, arq: 'Estándar' };

// ── Pasivas ────────────────────────────────────────────────────────────────
// Una por personaje: un distintivo SIEMPRE activo, sin botón. La regla de
// diseño: cada pasiva refuerza el arquetipo que los stats ya cuentan — no
// agrega un poder nuevo, exagera el que ya tenía.
//
// El efecto vive en el motor (player/collisions/match/main leen el
// characterId); acá está la ficha que muestran las galerías.
export const PASIVAS = {
  mago: {
    nombre: 'Segundo aliento', icono: '🌬️',
    desc: 'Regenera energía lentamente, todo el tiempo. Nunca llega vacío.',
  },
  mordrak: {
    nombre: 'Robo de esencia', icono: '🧪',
    desc: 'Cada golpe a la pelota le roba un sorbo de energía.',
  },
  zefir: {
    nombre: 'Tercer impulso', icono: '⚡',
    desc: 'Lleva 3 cargas de dash — los demás llevan 2.',
  },
  valka: {
    nombre: 'Inquebrantable', icono: '🛡️',
    desc: 'La explosión del gol casi no la mueve: planta el escudo y aguanta.',
  },
  petra: {
    nombre: 'Muralla', icono: '🪨',
    desc: 'Quien la embiste rebota con el doble de fuerza.',
  },
};

export function pasivaOf(id) { return PASIVAS[id] ?? null; }

export function statsOf(id) {
  return STATS[id] ?? NEUTRAL;
}

// Stat (1..5) → multiplicador (0.80 .. 1.20)
export function mulOf(stat) {
  return 1 + (stat - 3) * 0.10;
}

// Todos los multiplicadores de un personaje, listos para la física.
// `player.mods` guarda esto una vez al crear el jugador; el motor lo lee
// sin recalcular nada por frame.
export function modsOf(id) {
  const s = statsOf(id);
  const vel = mulOf(s.vel), man = mulOf(s.man), fue = mulOf(s.fue);
  const pes = mulOf(s.pes), mag = mulOf(s.mag);
  return {
    // Velocidad: empuje y techo. El drag cuadrático es el techo real de
    // velocidad, así que se INVIERTE (menos drag = más rápido).
    thrust: vel,
    dragQuad: 1 / vel,
    // Maniobra: resorte angular y torque máximo — qué tan rápido gira.
    angK: man,
    angAcc: man,
    // Fuerza: potencia del giro-golpe y del latigazo dirigido.
    shot: fue,
    // Peso: cuánto te empujan a VOS. Se invierte: más peso = menos empujón.
    // También multiplica lo que empujás vos al embestir.
    knockback: 1 / pes,
    ram: pes,
    // Magia: recarga del dash (invertida: más magia = recarga más rápida),
    // potencia del dash y gasto de boost (invertido: más magia = gasta menos).
    dashRecharge: 1 / mag,
    dashPower: mag,
    boostDrain: 1 / mag,
  };
}

// Suma de puntos — la usa la UI para mostrar el total y verificar balance.
export function totalOf(id) {
  const s = statsOf(id);
  return STAT_IDS.reduce((a, k) => a + s[k], 0);
}
