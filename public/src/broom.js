// La escoba: cuerpo rígido dominante. El mouse marca el ángulo objetivo,
// la escoba lo persigue con torque limitado (masa, inercia, resistencia).
import { CFG } from './config.js';
import { wrapAngle, clamp, damp } from './utils.js';

export class Broom {
  constructor(x, y, angle = 0) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.angle = angle;
    this.angVel = 0;
    this.thrustPower = 0;  // suavizado 0..1 para FX/sonido
    this.brakePower = 0;
    this.boosting = false;
    this.boostPower = 0;   // suavizado 0..1, lo leen los FX
    this.tuckAmount = 0;   // lo setea el jinete, lo usa el control
    this.aimLag = 0;       // desfase cursor↔escoba, lo lee el latigazo
    this.aimOverride = null; // ángulo forzado durante un golpe dirigido
    // --- Clavada en superficie ---
    this.stuck = null;       // { x, y, nx, ny, t, work, angle }
    this.stuckCd = 0;        // no se puede volver a clavar de inmediato
    this.strain = 0;         // 0..1 esfuerzo visible del forcejeo
    this._hoverT = Math.random() * 10; // fase propia (dos escobas no laten igual)
  }

  dir() { return { x: Math.cos(this.angle), y: Math.sin(this.angle) }; }
  tip() { const d = this.dir(); return { x: this.pos.x + d.x * CFG.broom.halfLen, y: this.pos.y + d.y * CFG.broom.halfLen }; }
  tail() { const d = this.dir(); return { x: this.pos.x - d.x * CFG.broom.halfLen, y: this.pos.y - d.y * CFG.broom.halfLen }; }

  // Punto local → mundo (rota con la escoba)
  toWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: this.pos.x + lx * c - ly * s, y: this.pos.y + lx * s + ly * c };
  }

  // Mundo → local (inversa de toWorld). La usa el golpe dirigido para saber
  // dónde cae la pelota dentro del arco del cuerpo.
  toLocal(wx, wy) {
    const dx = wx - this.pos.x, dy = wy - this.pos.y;
    const c = Math.cos(-this.angle), s = Math.sin(-this.angle);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  // Velocidad de un punto del cuerpo rígido
  velAt(px, py) {
    const rx = px - this.pos.x, ry = py - this.pos.y;
    return { x: this.vel.x - this.angVel * ry, y: this.vel.y + this.angVel * rx };
  }

  applyForceAt(px, py, fx, fy, dt) {
    this.vel.x += fx * dt;
    this.vel.y += fy * dt;
    const rx = px - this.pos.x, ry = py - this.pos.y;
    this.angVel += (rx * fy - ry * fx) / CFG.broom.inertia * dt;
  }

  applyImpulseAt(px, py, ix, iy) {
    this.vel.x += ix;
    this.vel.y += iy;
    const rx = px - this.pos.x, ry = py - this.pos.y;
    this.angVel += (rx * iy - ry * ix) / CFG.broom.inertia;
  }

  // Clava la punta en una superficie. Solo lo llama la detección de choque
  // frontal fuerte: acá ya está decidido que corresponde.
  impale(nx, ny) {
    // Se ancla la posición actual: la punta queda donde pegó.
    this.stuck = { x: this.pos.x, y: this.pos.y, nx, ny, t: 0, work: 0 };
    this.stuckAngle = this.angle;
    this.vel.x = 0; this.vel.y = 0; this.angVel = 0;
  }

  releaseStuck(dirX, dirY) {
    const S = CFG.stuck;
    this.stuck = null;
    this.stuckCd = S.cooldown;
    this.strain = 0;
    // Se desprende de golpe, hacia donde el jugador estaba forcejeando
    this.vel.x += dirX * S.popSpeed;
    this.vel.y += dirY * S.popSpeed;
    this.angVel += (Math.random() * 2 - 1) * 6;
  }

  // Mientras está clavada: el jugador cincha, el esfuerzo se acumula y al
  // llenarse (o al agotarse el tiempo) se libera. Devuelve la dirección del
  // forcejeo para que quien la llame haga los efectos.
  _updateStuck(dt, ctl) {
    const S = CFG.stuck;
    const s = this.stuck;
    s.t += dt;

    // Hacia dónde quiere ir el jugador: el cursor manda, el acelerador suma
    let tx = ctl.aim.x - this.pos.x, ty = ctl.aim.y - this.pos.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    // Cinchar en contra de la superficie es lo que la saca
    const pull = Math.max(0, -(tx * s.nx + ty * s.ny)) * 0.35 + 0.65;
    const effort = (ctl.thrust ? 1 : 0.45) * pull * S.escapeGain;
    s.work += effort * dt;
    this.strain = clamp(s.work / S.escapeWork, 0, 1);

    // La escoba vibra, cada vez más fuerte
    const shake = this.strain * 3.4;
    this.angle = this.stuckAngle + Math.sin(s.t * 46) * 0.05 * this.strain;
    this.pos.x = s.x - s.nx * 0 + Math.sin(s.t * 53) * shake * 0.35;
    this.pos.y = s.y + Math.cos(s.t * 61) * shake * 0.35;

    this.strainDir = { x: tx, y: ty }; // lo lee el jinete para cinchar

    const done = s.work >= S.escapeWork || s.t >= S.maxTime;
    if (done) { this.releaseStuck(tx, ty); return { released: true, tx, ty }; }
    return { released: false, tx, ty };
  }

  update(dt, ctl) {
    const B = CFG.broom;
    if (this.stuckCd > 0) this.stuckCd -= dt;
    if (this.stuck) return this._updateStuck(dt, ctl);
    this.strain = 0;

    // --- Rotación: perseguir el ángulo hacia el cursor ---
    const targetAngle = Math.atan2(ctl.aim.y - this.pos.y, ctl.aim.x - this.pos.x);
    const diff = wrapAngle(targetAngle - this.angle);
    // El desfase entre el cursor y la escoba ES el gesto del mouse: al flickear,
    // la escoba queda atrás y el signo delata hacia dónde se movió. El latigazo
    // lo usa para decidir su sentido, sin necesidad de leer eventos del mouse.
    this.aimLag = diff;

    // Durante un golpe dirigido la escoba deja de seguir al cursor y gira hacia
    // el golpe: eso es lo que hace que el personaje "dé la vuelta" aunque
    // estuviera de espaldas. Dura solo la ventana del latigazo.
    let useAngle = targetAngle, gain = 1;
    if (this.aimOverride != null) { useAngle = this.aimOverride; gain = B.overrideMul; }
    const useDiff = wrapAngle(useAngle - this.angle);

    const tuckMul = (1 + (B.tuckAngMul - 1) * this.tuckAmount) * gain;
    let angAcc = (B.angK * useDiff - B.angD * this.angVel) * tuckMul;
    angAcc = clamp(angAcc, -B.angAccMax * tuckMul, B.angAccMax * tuckMul);
    this.angVel += angAcc * dt;
    this.angVel *= Math.exp(-0.4 * dt); // leve fricción rotacional
    this.angle = wrapAngle(this.angle + this.angVel * dt);

    // --- Propulsión (LMB): fuerza hacia adelante ---
    // Con boost la escoba escupe mucha más fuerza y además respira mejor
    // (menos resistencia), así el techo de velocidad sube de verdad.
    this.boosting = !!ctl.boost && !!ctl.thrust;
    this.boostPower = damp(this.boostPower, this.boosting ? 1 : 0, 9, dt);
    this.thrustPower = damp(this.thrustPower, ctl.thrust ? 1 : 0, 12, dt);
    // `noThrustForce` lo usa la variante WASD: ahí el empuje no va en la
    // dirección de la escoba, lo aplica el propio modo. thrustPower se sigue
    // actualizando para que los FX y el sonido funcionen igual.
    if (ctl.thrust && !ctl.noThrustForce) {
      const d = this.dir();
      const mul = 1 + (CFG.boost.thrustMul - 1) * this.boostPower;
      this.vel.x += d.x * B.thrust * mul * dt;
      this.vel.y += d.y * B.thrust * mul * dt;
    }

    // --- Gravedad ---
    this.vel.y += B.gravity * dt;

    // --- Zumbido de levitación: leve vida propia SIEMPRE presente, aun sin
    // acelerar — vende que la escoba flota con magia y no está clavada en
    // el aire. Deliberadamente no tira hacia el cursor: mover el mouse
    // orienta (ver rotación arriba), pero moverse en el espacio sigue
    // siendo una decisión del jugador vía LMB.
    this._hoverT += dt;
    this.vel.x += Math.cos(this._hoverT * 2.3) * 9 * dt;
    this.vel.y += Math.sin(this._hoverT * 3.1) * 15 * dt;

    // --- Freno aéreo (RMB): la escoba frena, el cuerpo sigue ---
    this.brakePower = damp(this.brakePower, ctl.brake ? 1 : 0, 14, dt);
    let drag = B.dragLin + (ctl.brake ? B.brakeDrag : 0);

    // Resistencia del aire (lineal + cuadrática)
    const sp = Math.hypot(this.vel.x, this.vel.y);
    let quad = B.dragQuad * (1 - 0.25 * this.tuckAmount); // recogido = menos drag
    quad /= 1 + (CFG.boost.speedCapMul - 1) * this.boostPower;
    const f = Math.exp(-(drag + quad * sp) * dt);
    this.vel.x *= f;
    this.vel.y *= f;

    // --- Integración ---
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  reset(x, y, angle) {
    this.pos.x = x; this.pos.y = y;
    this.vel.x = 0; this.vel.y = 0;
    this.angle = angle; this.angVel = 0;
    this.thrustPower = 0; this.brakePower = 0;
  }
}
