// El jinete: active ragdoll con verlet.
// Regla fundamental: las manos NUNCA se sueltan de la escoba.
// El cuerpo tiene una postura deseada (resortes hacia el frame de la escoba)
// pero la física puede deformarla. Recuperación gradual, no instantánea.
import { CFG } from './config.js';
import { lerp, damp, wrapAngle, clamp } from './utils.js';

// Todas las posturas se escriben a escala 1 y se multiplican por CFG.charScale
// al cargar el módulo. Así los números siguen siendo legibles y agrandar al
// mago es tocar una sola constante en config.
// `k` NO escala (es una tasa: aceleración por unidad de desplazamiento, y el
// desplazamiento ya viene escalado). `cap` sí, porque es un tope de
// aceleración y las fuerzas crecen con el tamaño.
const S = CFG.charScale;
const scalePose = (pose) => {
  const out = {};
  for (const n of Object.keys(pose)) {
    const v = pose[n];
    out[n] = { ...v, x: v.x * S, y: v.y * S };
    if (v.r != null) out[n].r = v.r * S;
    if (v.cap != null) out[n].cap = v.cap * S;
  }
  return out;
};

// Postura base de jinete (frame local de la escoba: +x adelante, +y abajo)
const POSE_RIDE = scalePose({
  pelvis: { x: -16, y: -15, r: 10, k: 68, cap: 3000 },
  chest:  { x: -2,  y: -33, r: 10, k: 60, cap: 2800 },
  head:   { x: 6,   y: -51, r: 12, k: 46, cap: 2400 },
  kneeF:  { x: 2,   y: 3,   r: 6,  k: 36, cap: 2000 },
  footF:  { x: -7,  y: 21,  r: 7,  k: 26, cap: 1800 },
  kneeB:  { x: -7,  y: 5,   r: 6,  k: 36, cap: 2000 },
  footB:  { x: -16, y: 23,  r: 7,  k: 26, cap: 1800 },
});

// Postura recogida (Space): compacta, piernas al pecho
const POSE_TUCK = scalePose({
  pelvis: { x: -12, y: -19 },
  chest:  { x: 0,   y: -31 },
  head:   { x: 9,   y: -41 },
  kneeF:  { x: 8,   y: -14 },
  footF:  { x: 1,   y: -2 },
  kneeB:  { x: 1,   y: -12 },
  footB:  { x: -5,  y: 0 },
});

// Postura estirada (pico del latigazo): las piernas se extienden radialmente
// ALEJÁNDOSE del agarre. Es lo que pone los pies por fuera del alcance de la
// escoba y convierte el giro en un golpe de verdad.
const POSE_EXTEND = scalePose({
  pelvis: { x: -18, y: -14 },
  chest:  { x: -2,  y: -33 },
  head:   { x: 6,   y: -51 },
  kneeF:  { x: -40, y: -20 },
  footF:  { x: -60, y: -26 },
  kneeB:  { x: -42, y: -12 },
  footB:  { x: -63, y: -17 },
});

// Postura de inercia al ACELERAR: el cuerpo se queda atrás y se estira sobre
// el palo, como quien arranca de golpe en una moto. El torso baja y retrocede,
// la cabeza se hunde entre los hombros y las piernas se van al fondo. Es puro
// arrastre visual — la escoba ya se movió, el cuerpo todavía no.
const POSE_DRAG = scalePose({
  pelvis: { x: -30, y: -11 },
  chest:  { x: -18, y: -26 },
  head:   { x: -8,  y: -42 },
  kneeF:  { x: -14, y: 6 },
  footF:  { x: -30, y: 20 },
  kneeB:  { x: -24, y: 8 },
  footB:  { x: -40, y: 21 },
});

// Postura de inercia al FRENAR: el cuerpo sigue de largo hacia adelante y se
// comprime contra las manos. El torso se endereza y sube, las rodillas se
// pliegan. Es el opuesto exacto de POSE_DRAG y lo que hace que frenar se vea.
const POSE_LURCH = scalePose({
  pelvis: { x: -2,  y: -20 },
  chest:  { x: 12,  y: -35 },
  head:   { x: 22,  y: -50 },
  kneeF:  { x: 16,  y: -6 },
  footF:  { x: 6,   y: 14 },
  kneeB:  { x: 8,   y: -4 },
  footB:  { x: -2,  y: 16 },
});

// Agarres de las manos sobre el palo (siempre fijas ahí)
const GRIPS = scalePose({ handF: { x: 20, y: -3 }, handB: { x: 34, y: -2 } });

// Correa de postura: distancia máxima (unidades de mundo, se escala por S)
// que cada punto puede alejarse de su objetivo de pose. La física deforma
// dentro de este radio; más allá, se recorta. Es lo que impide que un golpe
// o giro deje una pierna arriba de la cabeza.
// Correa de postura: distancia máxima de cada punto a su objetivo de pose.
// Bajada en cabeza y piernas respecto de los valores originales: eran las
// partes que más se despegaban del cuerpo y las que más rompían la lectura
// (una cabeza a 32 unidades del cuello ya se lee como "desprendida"). Los
// límites de articulación de abajo se encargan del ángulo; esto, del alcance.
const LEASH = {
  pelvis: 24, chest: 24, head: 24,
  kneeF: 34, footF: 42, kneeB: 34, footB: 42,
};

// ── Límites de articulación ───────────────────────────────────────────────
// El problema que resuelven: los constraints de arriba preservan DISTANCIAS,
// no ÁNGULOS. Una pierna puede girar 360° alrededor de la cadera sin violar
// ninguna regla de longitud — por eso terminaba con la cabeza entre los pies
// o las rodillas dobladas al revés. Nada de eso lo detecta un stick.
//
// Un límite de articulación dice: "este punto no puede alejarse más de X
// grados de su ÁNGULO DE POSE respecto de su padre". Se aplica DESPUÉS de
// los constraints, empujando el punto de vuelta al borde del cono permitido
// (no al centro): la física sigue mandando dentro del rango y solo se
// interviene en el borde. Así se conserva el movimiento gracioso y se
// eliminan las poses imposibles.
//
// `max` en grados. Valores altos = más caos permitido.
const JOINT = {
  // El torso puede inclinarse bastante (la inercia lo tira), pero no darse
  // vuelta entero.
  chest:  { parent: 'pelvis', max: 62 },
  // La cabeza acompaña al torso: es lo que más molestaba cuando se iba.
  head:   { parent: 'chest',  max: 52 },
  // Caderas: buen rango (patear es parte del juego) pero sin vuelta completa.
  kneeF:  { parent: 'pelvis', max: 78 },
  kneeB:  { parent: 'pelvis', max: 78 },
  // Rodillas: el rango más chico. Una rodilla no se dobla para cualquier
  // lado, y verla hacerlo es lo que más "rompe" el personaje. Medido: con
  // 58° todavía el 18% de los frames caóticos mostraban la pantorrilla
  // quebrada hacia atrás; con 38° eso baja a casi cero y el pataleo del
  // latigazo sigue viéndose igual de suelto.
  footF:  { parent: 'kneeF',  max: 38 },
  footB:  { parent: 'kneeB',  max: 38 },
};

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
    this.shotMul = 1;         // potencia del golpe: carga × energía
    this.shotFire = false;    // ¿sale inflamado? (media reserva o más)
    this.lastChargeF = 0;
    this.lastEnergyF = 0;
    this.footTrail = [];   // estela visual de los pies durante el latigazo
    this.freezeFlip = null; // si no es null, fija el lado del cuerpo (1/-1) en
                             // vez de recalcularlo del ángulo — evita que un
                             // giro rápido (spin de golpe) cruce 90°/270°
                             // varias veces por segundo y rompa la pose.
    this.flipSide = 1;       // lado actual con histéresis: apuntando casi
                             // vertical (cos≈0) NO alterna — mantiene el lado
                             // hasta que el ángulo cruce con margen claro.

    // Crear puntos en la posición de la postura base
    for (const n of this.names) {
      const w = broom.toWorld(POSE_RIDE[n].x, POSE_RIDE[n].y);
      this.points[n] = { x: w.x, y: w.y, px: w.x, py: w.y, r: POSE_RIDE[n].r };
    }
    for (const n of Object.keys(GRIPS)) {
      const w = broom.toWorld(GRIPS[n].x, GRIPS[n].y);
      this.points[n] = { x: w.x, y: w.y, px: w.x, py: w.y, r: 5 * S };
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
    for (let i = 0; i < 6; i++) {
      const cx = c.x - i * 10 * S;
      this.cape.push({ x: cx, y: c.y, px: cx, py: c.y });
    }
    this.capeLen = 11 * S;
  }

  pointVel(p, dt) { return { x: (p.x - p.px) / dt, y: (p.y - p.py) / dt }; }

  // Potencia del golpe: cuánto se mantuvo Space × cuánta energía de orbes hay.
  // Se calcula UNA vez al soltar y queda fija para todo el movimiento, así el
  // golpe es un compromiso y no algo que cambia a mitad del arco.
  // Consume energía: gastar la reserva en un cañonazo o guardarla para el
  // impulso es la decisión.
  _shotPower(target) {
    const W = CFG.whip;
    const chargeF = clamp(
      (this.chargeT - W.minCharge) / Math.max(W.chargeFull - W.minCharge, 0.001), 0, 1);
    const energyF = clamp(target?.energyFrac ?? 0, 0, 1);
    this.lastChargeF = chargeF;
    this.lastEnergyF = energyF;
    // Media reserva o más: el tiro sale inflamado y suma potencia encima de
    // todo lo demás. Umbral y no rampa, para que se pueda mirar el frasco y
    // saber de antemano si toca el cañonazo.
    this.shotFire = energyF >= W.fireThreshold;
    if (energyF > 0 && W.energyCost > 0) target?.spendEnergy?.(W.energyCost);
    // FUERZA (stat): multiplica la potencia final del latigazo. El jinete
    // lee el mod de su escoba, que es donde lo dejó el Player.
    const fue = this.broom.mods ? this.broom.mods.shot : 1;
    return (1 + W.chargeBonus * chargeF + W.energyBonus * energyF
      + (this.shotFire ? W.fireBonus : 0)) * fue;
  }

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
            this.shotMul = this._shotPower(target);
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
              this.swingVel = t.dirSign * W.releaseVel * this.shotMul;
              this.broom.aimOverride = Math.atan2(t.hy, t.hx);
              this._lunge(t);
            } else {
              // Latigazo libre: sin blanco, puede fallar. Signo negativo para
              // que en el punto bajo del arco el pie barra hacia ADELANTE.
              this.aimed = false;
              this.aimDir = null;
              this.swingDir = dir;
              // El latigazo libre también gana: más carga = giro más violento
              this.swingVel = -W.releaseVel * dir * this.shotMul;
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

  // ── Límites de articulación ─────────────────────────────────────────────
  // Lo que la correa NO puede arreglar: la correa limita la DISTANCIA de un
  // punto a su objetivo, pero un pie puede estar a distancia perfectamente
  // válida y aun así quedar del lado equivocado de la rodilla. Eso es un
  // problema de ÁNGULO, y es exactamente lo que se veía como "articulaciones
  // dobladas al revés" o "la cabeza entre los pies".
  //
  // Cada articulación tiene un cono de libertad alrededor de su ángulo de
  // POSE (no de un ángulo fijo del mundo): dentro del cono la física manda y
  // el movimiento gracioso se conserva intacto; al llegar al borde, el punto
  // se rota de vuelta al límite conservando el largo del hueso.
  _applyJointLimits() {
    // El latigazo necesita más rango: el arco amplio del golpe es deliberado.
    const mul = this.phase === 'whip' ? 1.5 : 1;
    for (const n in JOINT) {
      const j = JOINT[n];
      const p = this.points[n], par = this.points[j.parent];
      if (!p || !par || p.poseAng == null) continue;

      const dx = p.x - par.x, dy = p.y - par.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.001) continue;

      const diff = wrapAngle(Math.atan2(dy, dx) - p.poseAng);
      const lim = (j.max * mul) * Math.PI / 180;
      if (Math.abs(diff) <= lim) continue;   // dentro del cono: no tocar

      const target = p.poseAng + (diff > 0 ? lim : -lim);
      const nx2 = par.x + Math.cos(target) * dist;
      const ny2 = par.y + Math.sin(target) * dist;
      // px/py acompañan la corrección: si no, al topar el límite el miembro
      // saldría disparado por la velocidad que el ajuste habría inyectado.
      p.px += nx2 - p.x; p.py += ny2 - p.y;
      p.x = nx2; p.y = ny2;
    }
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

    // Espejeo vertical: cuando la escoba apunta a la izquierda (cos < 0) la
    // pose local se voltea en Y para que el jinete siempre quede encima.
    // Se suaviza con el coseno del ángulo para que el flip sea gradual y no
    // un salto brusco al cruzar los 90°.
    // Lado del cuerpo con histéresis: solo cambia cuando el coseno cruza con
    // margen (|cos| > 0.10). Apuntando casi vertical el lado NO parpadea.
    // Si algo externo pidió congelar el lado (ej. un giro de 360° del golpe),
    // se respeta eso en vez de recalcular: si no, el cuerpo cruzaría el
    // umbral varias veces por segundo y quedaría en poses imposibles.
    const fc = Math.cos(this.broom.angle);
    if (Math.abs(fc) > 0.10) this.flipSide = fc >= 0 ? 1 : -1;
    const flip = this.freezeFlip ?? this.flipSide;

    // --- Inercia por aceleración ---
    // La escoba mide su aceleración a lo largo del palo; el cuerpo la sufre.
    // Acelerando se queda atrás (POSE_DRAG), frenando sigue de largo hacia
    // adelante (POSE_LURCH). Durante el latigazo se anula: ahí manda el golpe
    // y sumar arrastre encima ensuciaba el arco.
    const accel = this.phase === 'idle' ? (this.broom.accelLong ?? 0) : 0;
    const dragAmt  = clamp(accel, 0, 1) * R.dragPose;
    const lurchAmt = clamp(-accel, 0, 1) * R.lurchPose;

    // Sacudón del golpazo: escala con lo que queda de aturdimiento, así el
    // cuerpo se desarma en el impacto y se recompone solo.
    const slamT = this.broom.slamT ?? 0;
    const slamF = slamT > 0
      ? (slamT / CFG.stuck.slamTime) * (this.broom.slamMag ?? 1)
      : 0;
    this._slamPhase = (this._slamPhase ?? 0) + dt * 24;

    // --- Integración verlet + resortes de postura activa ---
    for (const n of this.names) {
      const p = this.points[n];
      const base = POSE_RIDE[n], tuck = POSE_TUCK[n], ext = POSE_EXTEND[n];
      // Blend en dos etapas: base→recogido, y ese resultado→estirado
      let lx = lerp(lerp(base.x, tuck.x, this.tuck), ext.x, this.extend);
      let ly = lerp(lerp(base.y, tuck.y, this.tuck), ext.y, this.extend);
      // Tercera etapa: la inercia. Va después del recogido y del estirado para
      // que se sume a lo que el jugador esté haciendo en vez de pisarlo.
      if (dragAmt > 0.001) {
        const dp = POSE_DRAG[n];
        lx = lerp(lx, dp.x, dragAmt);
        ly = lerp(ly, dp.y, dragAmt);
      } else if (lurchAmt > 0.001) {
        const lp = POSE_LURCH[n];
        lx = lerp(lx, lp.x, lurchAmt);
        ly = lerp(ly, lp.y, lurchAmt);
      }
      // Espejear Y cuando mira a la izquierda: el cuerpo siempre encima
      ly *= flip;
      // El cuerpo orbita el agarre. Las manos NO rotan (siguen clavadas al
      // palo más abajo): por eso esto es un giro colgado de las manos.
      if (swinging) {
        const pivotY = GRIP_PIVOT.y * flip;
        const rx = lx - GRIP_PIVOT.x, ry = ly - pivotY;
        lx = GRIP_PIVOT.x + rx * cs - ry * sn;
        ly = pivotY + rx * sn + ry * cs;
      }
      const target = this.broom.toWorld(lx, ly);

      // Golpazo contra una superficie: el cuerpo se sacude y queda blando un
      // instante, como si se hubiera desplomado sobre la escoba. Antes acá
      // estaba el forcejeo para desclavarse; se sacó junto con la clavada.
      if (slamF > 0.01) {
        const ph = this._slamPhase + (n === 'footF' || n === 'footB' ? 2.1 : 0);
        target.x += Math.sin(ph * 9) * slamF * 16;
        target.y += Math.cos(ph * 11 + 1.3) * slamF * 13;
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
      // Sin gravedad: el jinete flota con la escoba. Solo el resorte de postura
      // lo mantiene en forma, sin peso que lo tire al suelo.

      const vx = (p.x - p.px) * dragF;
      const vy = (p.y - p.py) * dragF;
      p.px = p.x; p.py = p.y;
      p.x += vx + ax * dt2;
      p.y += vy + ay * dt2;

      // Guardar el objetivo para la correa de postura (después de constraints)
      p.tx = target.x; p.ty = target.y;
    }

    // Ángulo de pose de cada articulación respecto de su padre. Es la
    // referencia contra la que se miden los límites más abajo: "cuánto te
    // desviaste de donde deberías estar". Se calcula sobre los TARGETS (la
    // pose ideal de este frame), no sobre las posiciones reales, para que el
    // cono de libertad acompañe la animación en vez de quedar fijo al mundo.
    for (const n in JOINT) {
      const j = JOINT[n];
      const p = this.points[n], par = this.points[j.parent];
      if (!p || !par || p.tx == null || par.tx == null) continue;
      p.poseAng = Math.atan2(p.ty - par.ty, p.tx - par.tx);
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

      // Límites de articulación DENTRO del bucle: si se aplicaran una sola
      // vez al final, el último pase de constraints volvería a sacar la
      // articulación del cono y el límite quedaría en la nada — medido: la
      // cabeza llegaba a 89° con un tope de 52°. Corriendo junto con los
      // constraints, ambos convergen a una pose que respeta las dos reglas.
      this._applyJointLimits();

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

    // --- Correa de postura: la física deforma, pero hasta acá ---
    // Cada punto queda atado a su objetivo de pose con un radio máximo. Sin
    // esto, impactos y giros rápidos dejan el cuerpo en configuraciones
    // imposibles (los constraints de hueso preservan largos, no topología).
    //
    // El largo de la correa responde a DOS cosas opuestas, y ahí está el truco:
    //  · acelerar/frenar la AFLOJA  → el cuerpo puede irse lejos, se ve elástico
    //  · girar rápido la APRIETA    → el cuerpo se mantiene armado en el giro
    // Antes había un solo multiplicador para todo, así que no se podía pedir
    // "más exagerado al acelerar" sin volver a romper el personaje al girar.
    // Con dos términos independientes cada gesto tiene su propio margen.
    let leashMul = this.phase === 'whip' ? 1.7 : 1;
    if (this.phase === 'idle') {
      const accelAbs = Math.min(Math.abs(this.broom.accelLong ?? 0), 1);
      leashMul *= 1 + accelAbs * (R.accelLeash - 1);
      const spinAmt = clamp(Math.abs(this.broom.angVel) / R.spinRef, 0, 1);
      leashMul *= lerp(1, R.spinLeash, spinAmt);
    }
    for (const n of this.names) {
      const p = this.points[n];
      if (p.tx == null) continue;
      const max = (LEASH[n] ?? 40) * S * leashMul;
      const dx = p.x - p.tx, dy = p.y - p.ty;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        const cx = p.tx + dx / d * max, cy = p.ty + dy / d * max;
        // Corregir posición sin inyectar velocidad (px/py acompañan el ajuste)
        p.px += cx - p.x; p.py += cy - p.y;
        p.x = cx; p.y = cy;
      }
    }

    // Pasada final de límites: los constraints de arriba pueden haber movido
    // algo en la última iteración, y la correa recién corrida también.
    this._applyJointLimits();

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

  // Carga 0..1 hacia la potencia MÁXIMA (no solo hacia el mínimo para
  // disparar): así el anillo comunica que aguantar más pega más fuerte.
  chargeAmount() {
    if (this.phase !== 'wind') return 0;
    return clamp(this.chargeT / CFG.whip.chargeFull, 0, 1);
  }

  // ¿Ya alcanza para disparar? Por debajo de esto, soltar no hace nada.
  isArmed() {
    return this.phase === 'wind' && this.chargeT >= CFG.whip.minCharge;
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
      // flameo mágico: la capa ondea sin gravedad, como si flotara en magia
      p.x += vx + (Math.sin(t * 7 + i) * 55 + Math.cos(t * 4.3 + i * 1.5) * 30) * dt2;
      p.y += vy + (Math.cos(t * 9 + i * 1.7) * 45 + Math.sin(t * 5.1 + i) * 20) * dt2;
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
    this.shotFire = false;
    this.broom.aimOverride = null;
    this.footTrail.length = 0;
    // Si el gol entra a mitad de un giro de 360°, el lado del cuerpo quedaba
    // congelado en el valor de ese giro y el mago revivía dado vuelta. Se
    // recalcula del ángulo real del saque en vez de heredar el del punto
    // anterior.
    this.freezeFlip = null;
    this.flipSide = Math.cos(this.broom.angle) >= 0 ? 1 : -1;
    this.shotMul = 1;
  }
}
