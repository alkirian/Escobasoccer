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
    // --- Golpazo contra superficie ---
    this.stuckCd = 0;        // no se puede encadenar dos golpazos
    this.slamT = 0;          // segundos de descontrol que quedan
    this.slamMag = 0;        // 0..1 fuerza del golpe, para los FX
    this.strain = 0;         // 0..1 esfuerzo visible (lo lee el jinete)
    // Aceleración a lo largo del palo, normalizada y suavizada (~[-1,1]).
    // + = acelerando, − = frenando. La lee el jinete para la inercia del cuerpo.
    this.accelLong = 0;
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

  // Golpe fuerte contra una superficie. Antes esto CLAVABA la escoba y había
  // que forcejear para salir; se sacó porque quedarse pegado a una pared corta
  // el ritmo del partido y se siente a castigo. Ahora el choque se nota —
  // rebota, gira descontrolado y el cuerpo se desarma un instante— pero el
  // control vuelve solo en `slamTime`, sin que el jugador tenga que hacer nada.
  slam(nx, ny, speed) {
    const S = CFG.stuck;
    // Rebote seco contra la pared: pierde casi toda la velocidad de entrada y
    // sale despedido hacia afuera, no la conserva como en un rebote elástico.
    const vn = this.vel.x * nx + this.vel.y * ny;
    this.vel.x = (this.vel.x - vn * nx * 1.7) * 0.28 + nx * S.slamPush;
    this.vel.y = (this.vel.y - vn * ny * 1.7) * 0.28 + ny * S.slamPush;
    // Descontrol: la escoba queda girando y por `slamTime` no obedece al
    // cursor. Es el "se desploma" — dura poco pero se ve.
    this.angVel += (Math.random() * 2 - 1) * S.slamSpin;
    this.slamT = S.slamTime;
    this.slamMag = clamp(speed / 900, 0.35, 1);
    this.stuckCd = S.cooldown;
  }

  update(dt, ctl) {
    const B = CFG.broom;
    if (this.stuckCd > 0) this.stuckCd -= dt;
    this.strain = 0;

    // Velocidad al entrar al paso: se compara contra la de salida para sacar
    // la aceleración real. Es lo que lee el jinete para estirarse hacia atrás
    // al acelerar y encogerse al frenar — sale de la física, no del input, así
    // que un choque o la onda del gol también lo deforman.
    const v0x = this.vel.x, v0y = this.vel.y;

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

    // Aturdimiento tras un golpazo: durante `slamT` la escoba casi no responde
    // al cursor, así que se la ve tumbada girando sola antes de reponerse. Se
    // recupera sola y rápido — es un tropiezo, no un castigo.
    if (this.slamT > 0) this.slamT = Math.max(0, this.slamT - dt);
    const slamF = this.slamT > 0 ? CFG.stuck.slamControl : 1;

    // MANIOBRA (stat): multiplica el resorte angular y el techo de torque.
    // `mods` puede no existir en escenas de prueba que crean Broom suelto.
    const M = this.mods;
    const manK = M ? M.angK : 1;
    const manA = M ? M.angAcc : 1;

    const tuckMul = (1 + (B.tuckAngMul - 1) * this.tuckAmount) * gain * slamF;
    let angAcc = (B.angK * manK * useDiff - B.angD * this.angVel) * tuckMul;
    angAcc = clamp(angAcc, -B.angAccMax * manA * tuckMul, B.angAccMax * manA * tuckMul);
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
      // Aturdido tampoco acelera: acelerar a fondo mientras la escoba está
      // dada vuelta anularía la sensación del golpe.
      // VELOCIDAD (stat): este es el camino que usan los BOTS (el humano
      // aplica su empuje a mano en main.js con noThrustForce).
      const mul = (1 + (CFG.boost.thrustMul - 1) * this.boostPower) * slamF
        * (M ? M.thrust : 1)
        * (this.aura ? CFG.runner.auraThrust : 1);   // aura de fuego
      this.vel.x += d.x * B.thrust * mul * dt;
      this.vel.y += d.y * B.thrust * mul * dt;
    }

    // --- Levitación mágica: sin gravedad, flotación ondulante ---
    // La escoba flota sola. En vez de caer, oscila suavemente en el aire
    // con ondas de amplitud y frecuencia distintas en X e Y para que el
    // movimiento se vea orgánico y no mecánico.
    this._hoverT += dt;
    // Ondas en Y: el empuje vertical neto es cero en promedio (no cae, no sube)
    // pero se siente vivo — como flotar en agua quieta.
    const hoverY = Math.sin(this._hoverT * 1.7) * 38          // onda lenta y amplia
                 + Math.sin(this._hoverT * 3.9 + 1.2) * 18;   // onda rápida y suave
    // Ondas en X: deriva lateral muy leve, hace que nunca esté perfectamente quieto.
    const hoverX = Math.cos(this._hoverT * 2.3 + 0.7) * 14
                 + Math.cos(this._hoverT * 5.1 + 2.4) * 6;
    this.vel.x += hoverX * dt;
    this.vel.y += hoverY * dt;

    // Amortiguación suave de la velocidad vertical cuando no hay input:
    // evita que la ondulación acumule deriva — la escoba oscila pero no
    // se va al cielo ni al suelo.
    if (!ctl.thrust) {
      this.vel.y *= Math.exp(-1.2 * dt);
      this.vel.x *= Math.exp(-0.5 * dt);
    }

    // --- Freno aéreo (RMB): la escoba frena, el cuerpo sigue ---
    this.brakePower = damp(this.brakePower, ctl.brake ? 1 : 0, 14, dt);
    let drag = B.dragLin + (ctl.brake ? B.brakeDrag : 0);

    // Resistencia del aire (lineal + cuadrática)
    const sp = Math.hypot(this.vel.x, this.vel.y);
    let quad = B.dragQuad * (1 - 0.25 * this.tuckAmount); // recogido = menos drag
    quad /= 1 + (CFG.boost.speedCapMul - 1) * this.boostPower;
    // VELOCIDAD (stat): el drag cuadrático ES el techo de velocidad, así que
    // menos drag = más rápido. Por eso el mod viene ya invertido.
    if (M) quad *= M.dragQuad;
    const f = Math.exp(-(drag + quad * sp) * dt);
    this.vel.x *= f;
    this.vel.y *= f;

    // --- Aceleración longitudinal (para la inercia del cuerpo) ---
    // Se proyecta el cambio de velocidad sobre el eje de la escoba: positivo
    // = ganando velocidad hacia adelante, negativo = frenando. Normalizado
    // contra la aceleración de propulsión, así queda en un rango ~[-1, 1]
    // independiente de la escala del juego. Suavizado porque el valor crudo
    // de un solo paso a 120 Hz salta demasiado para animar con él.
    {
      const d = this.dir();
      const along = ((this.vel.x - v0x) * d.x + (this.vel.y - v0y) * d.y) / Math.max(dt, 1e-6);
      const norm = clamp(along / B.thrust, -2.5, 2.5);
      this.accelLong = damp(this.accelLong ?? 0, norm, 11, dt);
    }

    // --- Integración ---
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  // Limpia TODO el estado, no solo la pose. Faltaba borrar `stuck`: un mago
  // clavado en la pared cuando entraba el gol revivía clavado, y en el primer
  // paso `_updateStuck` lo re-anclaba a las coordenadas viejas de la pared —
  // se teletransportaba fuera del saque. Ese era el bug de "arranca en otro
  // lado". Lo mismo con boost/override, que dejaban al mago acelerando o
  // apuntando a un objetivo del punto anterior.
  reset(x, y, angle) {
    this.pos.x = x; this.pos.y = y;
    this.vel.x = 0; this.vel.y = 0;
    this.angle = angle; this.angVel = 0;
    this.thrustPower = 0; this.brakePower = 0;
    this.stuckCd = 0;
    this.slamT = 0;
    this.slamMag = 0;
    this.strain = 0;
    this.accelLong = 0;
    this.strainDir = null;
    this.boosting = false;
    this.boostPower = 0;
    this.tuckAmount = 0;
    this.aimLag = 0;
    this.aimOverride = null;
  }
}
