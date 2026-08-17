// El jinete: active ragdoll con verlet.
// Regla fundamental: las manos NUNCA se sueltan de la escoba.
// El cuerpo tiene una postura deseada (resortes hacia el frame de la escoba)
// pero la física puede deformarla. Recuperación gradual, no instantánea.
import { CFG } from './config.js';
import { lerp, damp, wrapAngle } from './utils.js';

// Postura base de jinete (frame local de la escoba: +x adelante, +y abajo)
const POSE_RIDE = {
  pelvis: { x: -16, y: -15, r: 10, k: 68, cap: 3000 },
  chest:  { x: -2,  y: -33, r: 10, k: 60, cap: 2800 },
  head:   { x: 6,   y: -51, r: 12, k: 46, cap: 2400 },
  kneeF:  { x: 2,   y: 3,   r: 6,  k: 36, cap: 2000 },
  footF:  { x: -7,  y: 21,  r: 7,  k: 26, cap: 1800 },
  kneeB:  { x: -7,  y: 5,   r: 6,  k: 36, cap: 2000 },
  footB:  { x: -16, y: 23,  r: 7,  k: 26, cap: 1800 },
};

// Postura recogida (Space): compacta, piernas al pecho
const POSE_TUCK = {
  pelvis: { x: -12, y: -19 },
  chest:  { x: 0,   y: -31 },
  head:   { x: 9,   y: -41 },
  kneeF:  { x: 8,   y: -14 },
  footF:  { x: 1,   y: -2 },
  kneeB:  { x: 1,   y: -12 },
  footB:  { x: -5,  y: 0 },
};

// Postura estirada (pico del latigazo): las piernas se extienden radialmente
// ALEJÁNDOSE del agarre. Es lo que pone los pies por fuera del alcance de la
// escoba y convierte el giro en un golpe de verdad.
const POSE_EXTEND = {
  pelvis: { x: -18, y: -14 },
  chest:  { x: -2,  y: -33 },
  head:   { x: 6,   y: -51 },
  kneeF:  { x: -40, y: -20 },
  footF:  { x: -60, y: -26 },
  kneeB:  { x: -42, y: -12 },
  footB:  { x: -63, y: -17 },
};

// Agarres de las manos sobre el palo (siempre fijas ahí)
const GRIPS = { handF: { x: 20, y: -3 }, handB: { x: 34, y: -2 } };

// Pivote del latigazo: el punto medio entre las manos. Que el cuerpo orbite
// ACÁ y no el centro de la escoba es lo que hace todo el truco — el brazo de
// palanca se alarga y el ángulo de la escoba queda intacto.
const GRIP_PIVOT = { x: (GRIPS.handF.x + GRIPS.handB.x) / 2, y: (GRIPS.handF.y + GRIPS.handB.y) / 2 };

// Ángulo del pie estirado respecto del pivote, con swing = 0. Es la referencia
// que usa el golpe dirigido para saber cuánto girar hasta tocar la pelota.
const FOOT_BASE_ANGLE = Math.atan2(
  POSE_EXTEND.footF.y - GRIP_PIVOT.y,
  POSE_EXTEND.footF.x - GRIP_PIVOT.x,
);

export class Rider {
  constructor(broom) {
    this.broom = broom;
    this.tuck = 0; // 0..1 suavizado
    this.points = {};
    this.names = Object.keys(POSE_RIDE);

    // --- Latigazo ---
    this.phase = 'idle';   // idle | wind | whip
    this.swing = 0;        // ángulo del cuerpo alrededor del agarre (rad)
    this.swingVel = 0;
    this.swingDir = 1;
    this.extend = 0;       // 0..1, cuánto se estiran las piernas
    this.chargeT = 0;
    this.whipT = 0;
    this.cooldownT = 0;
    this.aimed = false;       // ¿el golpe salió dirigido a la pelota?
    this.aimDir = null;       // dirección hacia la que debe salir la pelota
    this.aimBall = null;      // referencia viva a la pelota que persigue
    this.hasContacted = false;
    this.footTrail = [];   // estela visual de los pies durante el latigazo

    // Crear puntos en la posición de la postura base
    for (const n of this.names) {
      const w = broom.toWorld(POSE_RIDE[n].x, POSE_RIDE[n].y);
      this.points[n] = { x: w.x, y: w.y, px: w.x, py: w.y, r: POSE_RIDE[n].r };
    }
    for (const n of Object.keys(GRIPS)) {
      const w = broom.toWorld(GRIPS[n].x, GRIPS[n].y);
      this.points[n] = { x: w.x, y: w.y, px: w.x, py: w.y, r: 5 };
    }

    // Constraints: sticks (rígidos) y ropes (solo longitud máxima → brazos)
    const L = (a, b) => {
      const pa = POSE_RIDE[a] || GRIPS[a], pb = POSE_RIDE[b] || GRIPS[b];
      return Math.hypot(pa.x - pb.x, pa.y - pb.y);
    };
    this.constraints = [
      { a: 'pelvis', b: 'chest', len: L('pelvis', 'chest'), type: 'stick' },
      { a: 'chest', b: 'head', len: L('chest', 'head'), type: 'stick' },
      { a: 'chest', b: 'handF', len: L('chest', 'handF'), type: 'rope' },
      { a: 'chest', b: 'handB', len: L('chest', 'handB'), type: 'rope' },
      { a: 'pelvis', b: 'kneeF', len: L('pelvis', 'kneeF'), type: 'stick' },
      { a: 'kneeF', b: 'footF', len: L('kneeF', 'footF'), type: 'stick' },
      { a: 'pelvis', b: 'kneeB', len: L('pelvis', 'kneeB'), type: 'stick' },
      { a: 'kneeB', b: 'footB', len: L('kneeB', 'footB'), type: 'stick' },
    ];

    // Capa: cadena verlet colgando del pecho (solo visual, vende el movimiento)
    this.cape = [];
    const c = this.points.chest;
    for (let i = 0; i < 6; i++) this.cape.push({ x: c.x - i * 10, y: c.y, px: c.x - i * 10, py: c.y });
    this.capeLen = 11;
  }

  pointVel(p, dt) { return { x: (p.x - p.px) / dt, y: (p.y - p.py) / dt }; }

  // Al soltar, si la pelota está en rango el latigazo se vuelve un GOLPE
  // DIRIGIDO: se elige el sentido del giro para que el pie barra la pelota
  // hacia el cursor, y la escoba gira para acompañar. Aunque el jugador esté
  // de espaldas, da la vuelta y pega. Devuelve null si no hay blanco.
  _acquireTarget(target) {
    if (!target || !target.ball) return null;
    const W = CFG.whip;
    const b = this.broom;
    const ball = target.ball;

    const dx = ball.x - b.pos.x, dy = ball.y - b.pos.y;
    if (Math.hypot(dx, dy) > W.range) return null;

    // Hacia dónde queremos mandarla: de la pelota al cursor.
    let hx = target.aim.x - ball.x, hy = target.aim.y - ball.y;
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl; hy /= hl;

    // Pivote del giro (las manos) en mundo, y radio hacia la pelota.
    const pivot = b.toWorld(GRIP_PIVOT.x, GRIP_PIVOT.y);
    let rx = ball.x - pivot.x, ry = ball.y - pivot.y;
    const rl = Math.hypot(rx, ry) || 1;
    rx /= rl; ry /= rl;

    // El pie va tangente al radio: hay dos sentidos posibles. Se elige el que
    // empuja más hacia el cursor.
    const dotCCW = (-ry) * hx + rx * hy;
    const dirSign = dotCCW >= 0 ? 1 : -1;

    // Ángulo del blanco dentro del arco del cuerpo (en el frame de la escoba).
    const ballLocal = b.toLocal(ball.x, ball.y);
    const thetaBall = Math.atan2(ballLocal.y - GRIP_PIVOT.y, ballLocal.x - GRIP_PIVOT.x);
    const contactSwing = wrapAngle(thetaBall - FOOT_BASE_ANGLE);

    return { dirSign, contactSwing, hx, hy, bx: ball.x, by: ball.y };
  }

  // Persecución: mientras no tocó, la escoba sigue empujando hacia la pelota.
  // Es una aceleración normal (la misma clase de fuerza que el acelerador),
  // no un teletransporte, así el movimiento sigue leyéndose como físico.
  _homeToBall(dt) {
    const W = CFG.whip;
    const b = this.broom;
    const ball = this.aimBall;
    if (!ball) return;
    let dx = ball.x - b.pos.x, dy = ball.y - b.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < W.reachPad * 0.5) return; // ya está encima, no hace falta empujar
    b.vel.x += (dx / d) * W.homingAcc * dt;
    b.vel.y += (dy / d) * W.homingAcc * dt;
  }

  // Lo llama collisions.js cuando el golpe dirigido efectivamente conectó:
  // ahí termina la persecución y el cuerpo vuelve a la física normal.
  notifyAimedContact() {
    this.hasContacted = true;
  }

  // Estocada hacia la pelota: solo acelera si no se está acercando lo
  // suficiente por sí solo, y con tope. Así el golpe conecta sin que el
  // movimiento se sienta teletransportado.
  _lunge(t) {
    const W = CFG.whip;
    const b = this.broom;
    let dx = t.bx - b.pos.x, dy = t.by - b.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    dx /= dist; dy /= dist;
    const need = (dist - W.reachPad) / W.lungeTime;
    if (need <= 0) return;
    const closing = b.vel.x * dx + b.vel.y * dy;
    if (need <= closing) return; // ya llega solo
    const add = Math.min(need - closing, W.lungeMax);
    b.vel.x += dx * add;
    b.vel.y += dy * add;
  }

  // Máquina de estados del latigazo. Detecta los flancos de Space por sí sola
  // (recibe tuckHeld en cada subpaso), así que la entrada no necesita plomería.
  _updateWhip(dt, tuckHeld, target) {
    const W = CFG.whip;
    if (this.cooldownT > 0) this.cooldownT -= dt;

    switch (this.phase) {
      case 'idle':
        if (tuckHeld) { this.phase = 'wind'; this.chargeT = 0; }
        break;

      case 'wind': {
        this.chargeT += dt;
        // El cuerpo se enrolla hacia atrás y arriba, como quien amaga una
        // patada. El sentido se previsualiza en vivo: el jugador ve para dónde
        // va a salir antes de soltar.
        const dir = this._flickDir();
        this.swing = damp(this.swing, W.windAngle * dir, W.windSpeed, dt);
        if (!tuckHeld) {
          if (this.chargeT >= W.minCharge && this.cooldownT <= 0) {
            const t = this._acquireTarget(target);
            if (t) {
              // GOLPE DIRIGIDO: el arco arranca antes del contacto y barre
              // hacia él, así el cuerpo "da la vuelta" y llega apuntando.
              this.aimed = true;
              this.hasContacted = false;
              this.aimBall = target.ball; // referencia viva: la persigue si se mueve
              this.aimDir = { x: t.hx, y: t.hy };
              this.swingDir = t.dirSign;
              this.swing = wrapAngle(t.contactSwing - t.dirSign * W.spinLead);
              this.swingVel = t.dirSign * W.releaseVel;
              this.broom.aimOverride = Math.atan2(t.hy, t.hx);
              this._lunge(t);
            } else {
              // Latigazo libre: sin blanco, puede fallar. Signo negativo para
              // que en el punto bajo del arco el pie barra hacia ADELANTE.
              this.aimed = false;
              this.aimDir = null;
              this.swingDir = dir;
              this.swingVel = -W.releaseVel * dir;
            }
            this.phase = 'whip';
            this.whipT = 0;
            this.cooldownT = W.cooldown;
            this.footTrail.length = 0;
          } else {
            this.phase = 'idle'; // toque corto: solo giró más rápido, sin latigazo
          }
        }
        break;
      }

      case 'whip': {
        this.whipT += dt;
        // Mientras el golpe dirigido no conectó, sigue girando y persiguiendo:
        // el cuerpo da vueltas y la escoba va hacia la pelota hasta tocarla.
        const seeking = this.aimed && !this.hasContacted;
        const dur = seeking ? W.maxDuration : W.duration;
        this.swingVel *= Math.exp(-(seeking ? W.seekDamping : W.damping) * dt);
        this.swing += this.swingVel * dt;
        if (seeking) this._homeToBall(dt);
        // Momento angular: recogido gira rápido, y al estirarse las piernas
        // salen despedidas. Buscando, las piernas quedan estiradas todo el
        // giro para maximizar el alcance.
        const prog = this.whipT / dur;
        const want = seeking ? 1 : (prog > W.extendAt && prog < 0.96 ? 1 : 0);
        this.extend = damp(this.extend, want, 26, dt);
        if (this.whipT >= dur) {
          this.phase = 'idle';
          this.aimed = false;
          this.aimDir = null;
          this.aimBall = null;
          this.broom.aimOverride = null; // el mouse recupera el control
        }
        break;
      }
    }

    if (this.phase === 'idle') {
      this.extend = damp(this.extend, 0, 10, dt);
      // resorte de vuelta a la postura normal
      this.swingVel += (-W.returnK * this.swing - W.returnD * this.swingVel) * dt;
      this.swing += this.swingVel * dt;
    }
  }

  // Sentido del latigazo leído del desfase cursor↔escoba. Con el mouse quieto
  // el desfase es ~0 y sale hacia adelante por defecto.
  _flickDir() {
    const lag = this.broom.aimLag || 0;
    if (Math.abs(lag) < CFG.whip.flickThreshold) return 1;
    return lag > 0 ? 1 : -1;
  }

  update(dt, tuckHeld, target) {
    const R = CFG.rider;
    this._updateWhip(dt, tuckHeld, target);

    // Durante la carga el cuerpo se recoge; al latiguear se abre rápido.
    const wantTuck = this.phase === 'wind' ? 1 : (this.phase === 'whip' ? 0 : (tuckHeld ? 1 : 0));
    const tuckRate = this.phase === 'whip' ? R.tuckSpeed * 3 : R.tuckSpeed;
    this.tuck = damp(this.tuck, wantTuck, tuckRate, dt);
    this.broom.tuckAmount = this.tuck;

    const dragF = Math.exp(-R.drag * dt);
    const dt2 = dt * dt;
    const swinging = this.phase !== 'idle' || Math.abs(this.swing) > 0.002;
    const cs = Math.cos(this.swing), sn = Math.sin(this.swing);

    // --- Integración verlet + resortes de postura activa ---
    for (const n of this.names) {
      const p = this.points[n];
      const base = POSE_RIDE[n], tuck = POSE_TUCK[n], ext = POSE_EXTEND[n];
      // Blend en dos etapas: base→recogido, y ese resultado→estirado
      let lx = lerp(lerp(base.x, tuck.x, this.tuck), ext.x, this.extend);
      let ly = lerp(lerp(base.y, tuck.y, this.tuck), ext.y, this.extend);
      // El cuerpo orbita el agarre. Las manos NO rotan (siguen clavadas al
      // palo más abajo): por eso esto es un giro colgado de las manos.
      if (swinging) {
        const rx = lx - GRIP_PIVOT.x, ry = ly - GRIP_PIVOT.y;
        lx = GRIP_PIVOT.x + rx * cs - ry * sn;
        ly = GRIP_PIVOT.y + rx * sn + ry * cs;
      }
      const target = this.broom.toWorld(lx, ly);

      // Clavado: el cuerpo cincha hacia donde el jugador quiere ir. El torso
      // se estira, los brazos se tensan y las piernas se balancean — cuanto
      // más forcejea, más evidente el esfuerzo.
      const strain = this.broom.strain;
      if (strain > 0.01 && this.broom.strainDir) {
        const sd = this.broom.strainDir;
        const reach = strain * 34 * (n === 'head' || n === 'chest' ? 1.25 : 1);
        target.x += sd.x * reach;
        target.y += sd.y * reach;
        if (n === 'footF' || n === 'footB') {
          const kick = Math.sin(this.broom.stuck.t * 17 + (n === 'footF' ? 0 : 2)) * strain * 22;
          target.x += -sd.y * kick;
          target.y += sd.x * kick;
        }
      }

      // Resorte hacia la postura deseada, con tope: impactos grandes lo superan
      let ax = (target.x - p.x) * base.k;
      let ay = (target.y - p.y) * base.k;
      const mag = Math.hypot(ax, ay);
      // Recogido = más firme. Durante el latigazo el tope sube mucho: si no,
      // el cuerpo no llega a seguir el arco y el golpe sale sin fuerza.
      let cap = base.cap * (1 + 0.5 * this.tuck);
      if (this.phase === 'whip') cap *= 4;
      if (mag > cap) { ax = ax / mag * cap; ay = ay / mag * cap; }
      ay += R.gravity;

      const vx = (p.x - p.px) * dragF;
      const vy = (p.y - p.py) * dragF;
      p.px = p.x; p.py = p.y;
      p.x += vx + ax * dt2;
      p.y += vy + ay * dt2;
    }

    // --- Constraints + manos fijas ---
    let reactX = 0, reactY = 0, reactPX = 0, reactPY = 0; // reacción acumulada
    const gripF = this.broom.toWorld(GRIPS.handF.x, GRIPS.handF.y);
    const gripB = this.broom.toWorld(GRIPS.handB.x, GRIPS.handB.y);

    for (let it = 0; it < R.iterations; it++) {
      // Fijar manos al palo al inicio de cada iteración
      this.points.handF.x = gripF.x; this.points.handF.y = gripF.y;
      this.points.handB.x = gripB.x; this.points.handB.y = gripB.y;

      for (const c of this.constraints) {
        const pa = this.points[c.a], pb = this.points[c.b];
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy) || 0.0001;
        let maxLen = c.type === 'rope' ? c.len * CFG.rider.armStretch : c.len;
        if (c.type === 'rope' && d < c.len * 0.55) maxLen = c.len * 0.55; // no atravesar
        else if (c.type === 'rope' && d <= c.len * CFG.rider.armStretch) continue;
        const diff = (d - maxLen) / d * 0.5;
        pa.x += dx * diff; pa.y += dy * diff;
        pb.x -= dx * diff; pb.y -= dy * diff;
      }

      // Medir cuánto se movieron las manos → el cuerpo tira de la escoba
      reactX += this.points.handF.x - gripF.x + (this.points.handB.x - gripB.x);
      reactY += this.points.handF.y - gripF.y + (this.points.handB.y - gripB.y);
    }

    // Re-fijar manos definitivamente, con velocidad del punto de agarre
    const gv = this.broom.velAt(gripF.x, gripF.y);
    this.points.handF.x = gripF.x; this.points.handF.y = gripF.y;
    this.points.handF.px = gripF.x - gv.x * dt; this.points.handF.py = gripF.y - gv.y * dt;
    const gv2 = this.broom.velAt(gripB.x, gripB.y);
    this.points.handB.x = gripB.x; this.points.handB.y = gripB.y;
    this.points.handB.px = gripB.x - gv2.x * dt; this.points.handB.py = gripB.y - gv2.y * dt;

    // Influencia secundaria del cuerpo sobre la escoba (control > caos).
    // Durante el latigazo el tope sube: lanzar el cuerpo empuja la escoba
    // (Newton) y se siente el peso, pero sigue acotado — el rumbo lo manda
    // el mouse.
    let fx = reactX * R.reactK, fy = reactY * R.reactK;
    const maxReact = this.phase === 'whip' ? CFG.whip.recoilMax : R.reactMax;
    const fm = Math.hypot(fx, fy);
    if (fm > maxReact) { fx = fx / fm * maxReact; fy = fy / fm * maxReact; }
    const gripMid = { x: (gripF.x + gripB.x) / 2, y: (gripF.y + gripB.y) / 2 };
    this.broom.applyForceAt(gripMid.x, gripMid.y, fx, fy, dt);

    // --- Estela de los pies (solo visual, vende la velocidad del latigazo) ---
    if (this.phase === 'whip') {
      this.footTrail.push({ x: this.points.footF.x, y: this.points.footF.y });
      if (this.footTrail.length > 14) this.footTrail.shift();
    } else if (this.footTrail.length) {
      this.footTrail.shift();
    }

    // --- Capa ---
    this._updateCape(dt);
  }

  // ¿Cuánta carga lleva? 0..1 — lo usa el HUD para el indicador.
  chargeAmount() {
    if (this.phase !== 'wind') return 0;
    return Math.min(this.chargeT / CFG.whip.minCharge, 1);
  }

  _updateCape(dt) {
    const c = this.points.chest;
    const dt2 = dt * dt;
    const t = performance.now() / 1000;
    for (let i = 1; i < this.cape.length; i++) {
      const p = this.cape[i];
      const vx = (p.x - p.px) * 0.96;
      const vy = (p.y - p.py) * 0.96;
      p.px = p.x; p.py = p.y;
      // gravedad + flameo
      p.x += vx + (Math.sin(t * 7 + i) * 60) * dt2;
      p.y += vy + (300 + Math.cos(t * 9 + i * 1.7) * 80) * dt2;
    }
    // anclar al pecho y resolver cadena
    this.cape[0].x = c.x; this.cape[0].y = c.y;
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < this.cape.length; i++) {
        const a = this.cape[i - 1], b = this.cape[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - this.capeLen) / d;
        const w = i === 1 ? 1 : 0.5;
        b.x -= dx * diff * w; b.y -= dy * diff * w;
        if (i > 1) { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; }
      }
      this.cape[0].x = c.x; this.cape[0].y = c.y;
    }
  }

  // Puntos que interactúan con la pelota y otros jugadores
  hitPoints() {
    return ['head', 'chest', 'pelvis', 'kneeF', 'footF', 'kneeB', 'footB'].map(n => ({ name: n, p: this.points[n] }));
  }

  reset() {
    for (const n of this.names) {
      const w = this.broom.toWorld(POSE_RIDE[n].x, POSE_RIDE[n].y);
      const p = this.points[n];
      p.x = w.x; p.y = w.y; p.px = w.x; p.py = w.y;
    }
    for (const n of Object.keys(GRIPS)) {
      const w = this.broom.toWorld(GRIPS[n].x, GRIPS[n].y);
      const p = this.points[n];
      p.x = w.x; p.y = w.y; p.px = w.x; p.py = w.y;
    }
    const c = this.points.chest;
    for (const p of this.cape) { p.x = c.x; p.y = c.y; p.px = c.x; p.py = c.y; }
    this.tuck = 0;
    this.phase = 'idle';
    this.swing = 0; this.swingVel = 0; this.extend = 0;
    this.chargeT = 0; this.whipT = 0; this.cooldownT = 0;
    this.aimed = false; this.aimDir = null; this.aimBall = null;
    this.hasContacted = false;
    this.broom.aimOverride = null;
    this.footTrail.length = 0;
  }
}
