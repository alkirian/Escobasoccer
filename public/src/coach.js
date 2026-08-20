// El coach: enseña los controles JUGANDO, no con pantallas.
//
// Cada lección tiene un disparador contextual — una situación del partido en
// la que ese control es útil AHORA — y un ancla visual: el cartel aparece al
// lado de la cosa que explica (la pelota, los rayos del dash, la barra de
// energía), no siempre abajo al centro. Es la diferencia entre un manual y un
// entrenador: te dice "golpeá" cuando tenés la pelota cerca, no cuando llegó
// tu turno en una lista.
//
// El circuito de aprendizaje: si hacés la acción mientras la lección está
// visible, aparece un "✓" verde y esa lección muere PARA SIEMPRE (se persiste
// en localStorage). Aprendiste haciendo y el juego te lo confirmó. Si la
// ignorás 3 veces, tampoco insiste más — no todos quieren tutorial.
//
// Una sola lección visible a la vez, con respiro entre lecciones. Nunca pausa
// ni bloquea: es un susurro al costado, no un cartel.

import { Storage } from './storage/storage.js';
import { t } from './i18n/i18n.js';
const STORE_KEY = 'escoba.coach.v1';

// Cuánto vive un cartel, cuánto respira entre lecciones, cuántas veces
// insiste antes de rendirse.
const SHOW_MAX   = 6.0;   // segundos visibles por aparición
const LINGER     = 1.2;   // el disparador puede apagarse este rato sin ocultar
const COOLDOWN   = 4.0;   // silencio entre lecciones
const MAX_SHOWS  = 3;     // apariciones antes de darse por vencido
const FLASH_TIME = 0.9;   // duración del ✓ de completado

function loadDone() {
  try {
    const raw = Storage.get(STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw).done || {};
  } catch { return {}; }
}

function saveDone(done) {
  try { Storage.set(STORE_KEY, JSON.stringify({ done })); } catch { /* sin storage */ }
}

// ── Lecciones ──────────────────────────────────────────────────────────────
// `when(w, L)`  → ¿es AHORA el momento de esta lección? (w = world, L = estado propio)
// `learned(w, L)` → ¿el jugador ya hizo la acción? Se evalúa siempre, esté o no
//                   visible el cartel: si ya sabés golpear, la lección del
//                   golpe no aparece nunca.
// `anchor` → dónde se dibuja: 'player' | 'ball' | 'dashHud' | 'energyHud'
//            (las coordenadas las resuelve el renderer, que conoce el layout).
const LESSONS = [
  {
    id: 'mover', key: t('key.mouse'), text: t('coach.mover'),
    anchor: 'player',
    when: (w, L) => L.coachAge < 7 && w.input.mouseMoved < 300,
    learned: (w) => w.input.mouseMoved > 600,
  },
  {
    id: 'golpe', key: t('key.click'), text: t('coach.golpe'),
    anchor: 'ball',
    when: (w) => {
      const b = w.playerA.broom, ball = w.ball;
      if (ball.frozen) return false;
      return Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) < 320;
    },
    // Soltar un golpe (conecte o no) demuestra que el control se entendió.
    learned: (w, L) => {
      const firing = !!w.spin?.active;
      const rose = firing && !L.prevSpin;
      L.prevSpin = firing;
      return rose;
    },
  },
  {
    id: 'dash', key: t('key.space'), text: t('coach.dash'),
    anchor: 'dashHud',
    when: (w) => {
      const d = w.dashState;
      if (!d || d.charges < d.maxCharges) return false;
      if (w.match?.dashAllowed && !w.match.dashAllowed()) return false;
      const b = w.playerA.broom, ball = w.ball;
      // El momento en que el dash sirve: la pelota está lejos.
      return Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) > 650;
    },
    learned: (w, L) => {
      const on = !!w.dashState?.active;
      const rose = on && !L.prevDash;
      L.prevDash = on;
      return rose;
    },
  },
  {
    id: 'boost', key: t('key.shift'), text: t('coach.boost'),
    anchor: 'energyHud',
    // Recién cuando hay energía que gastar — o sea, después del primer orbe.
    when: (w) => (w.playerA.energy || 0) > 8,
    learned: (w, L) => {
      if (L.boostBase == null) L.boostBase = w.input.boostTime;
      return w.input.boostTime - L.boostBase > 0.35;
    },
  },
  {
    id: 'flotar', key: t('key.rclick'), text: t('coach.flotar'),
    anchor: 'player',
    // Pasarse de largo: vas rápido y alejándote de la pelota. Sostenido un
    // ratito, para no saltar por un roce.
    when: (w, L, dt) => {
      const b = w.playerA.broom, ball = w.ball;
      const sp = Math.hypot(b.vel.x, b.vel.y);
      const dx = ball.pos.x - b.pos.x, dy = ball.pos.y - b.pos.y;
      const away = (b.vel.x * dx + b.vel.y * dy) < 0;
      L.overshootT = (sp > 650 && away && !ball.frozen) ? (L.overshootT || 0) + dt : 0;
      return L.overshootT > 0.5;
    },
    learned: (w, L) => {
      if (L.brakeBase == null) L.brakeBase = w.input.brakeTime;
      return w.input.brakeTime - L.brakeBase > 0.25;
    },
  },
];

export class Coach {
  constructor() {
    this.done = loadDone();
    this.state = {};              // estado propio por lección (edges, timers)
    for (const l of LESSONS) this.state[l.id] = { coachAge: 0 };

    this.current = null;          // lección visible (objeto de LESSONS)
    this.age = 0;                 // cuánto lleva visible
    this.hideT = 0;               // cuánto lleva el disparador apagado
    this.shows = {};              // apariciones por lección
    this.cooldown = 0;
    this.flash = null;            // { anchor, t } → el ✓ de completado
    this.t = 0;                   // reloj total del coach
  }

  _complete(lesson, withFlash) {
    this.done[lesson.id] = true;
    saveDone(this.done);
    if (withFlash) this.flash = { anchor: lesson.anchor, t: FLASH_TIME };
    if (this.current === lesson) { this.current = null; this.cooldown = COOLDOWN; }
  }

  // Llamar una vez por frame con dt real, solo con el partido corriendo.
  update(dt, world) {
    this.t += dt;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.flash) {
      this.flash.t -= dt;
      if (this.flash.t <= 0) this.flash = null;
    }

    // 1) Aprendizaje, visible o no: si el jugador ya hace la acción por su
    //    cuenta, la lección se marca sabida en silencio y no molesta nunca.
    for (const l of LESSONS) {
      if (this.done[l.id]) continue;
      const L = this.state[l.id];
      L.coachAge = this.t;
      if (l.learned(world, L)) this._complete(l, this.current === l);
    }

    // 2) Lección visible: ¿sigue teniendo sentido?
    if (this.current) {
      const l = this.current;
      this.age += dt;
      const stillWanted = !this.done[l.id] && l.when(world, this.state[l.id], dt);
      this.hideT = stillWanted ? 0 : this.hideT + dt;
      if (this.age > SHOW_MAX || this.hideT > LINGER) {
        this.shows[l.id] = (this.shows[l.id] || 0) + 1;
        if (this.shows[l.id] >= MAX_SHOWS) {
          // Ignorada 3 veces: no insistir más (persistido como sabida).
          this.done[l.id] = true;
          saveDone(this.done);
        }
        this.current = null;
        this.cooldown = COOLDOWN;
      }
      return;
    }

    // 3) Sin lección visible: buscar la primera cuyo momento sea ahora.
    if (this.cooldown > 0) return;
    for (const l of LESSONS) {
      if (this.done[l.id]) continue;
      if ((this.shows[l.id] || 0) >= MAX_SHOWS) continue;
      if (l.when(world, this.state[l.id], dt)) {
        this.current = l;
        this.age = 0;
        this.hideT = 0;
        return;
      }
    }
  }
}
