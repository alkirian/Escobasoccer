// Jugador = escoba + jinete + control (humano o bot)
import { Broom } from './broom.js';
import { Rider } from './rider.js';
import { CFG } from './config.js';
import { clamp, damp } from './utils.js';

export class Player {
  constructor(x, y, angle, team) {
    this.team = team; // 'p1' | 'p2'
    this.broom = new Broom(x, y, angle);
    this.rider = new Rider(this.broom);
    this.control = { aim: { x: x + 100, y: y }, thrust: false, brake: false, tuck: false, boost: false };
    this.spawn = { x, y, angle };
    this.ramCd = 0;         // enfriamiento entre embestidas (evita ráfagas)
    this.energy = 0;        // reserva mágica de los orbes
    this.energyPulse = 0;   // destello del HUD al recoger
    this.unlimitedT = 0;    // energía ilimitada del orbe fugitivo (segundos)
  }

  // Energía: la suman los orbes, la gasta el boost. Solo se puede arrancar
  // el boost con algo de reserva, para que no sea un parpadeo constante.
  addEnergy(amount) {
    this.energy = clamp(this.energy + amount, 0, CFG.boost.max);
    this.energyPulse = 1;
  }

  // Premio del orbe fugitivo: durante unos segundos el frasco no baja.
  // Se toma el máximo en vez de sumar, para que atrapar dos seguidos no
  // encadene un buff eterno.
  grantUnlimited(seconds) {
    this.unlimitedT = Math.max(this.unlimitedT, seconds);
    this.energy = CFG.boost.max;
    this.energyPulse = 1;
  }

  get unlimited() { return this.unlimitedT > 0; }

  // Único punto por el que se descuenta energía (boost aparte). Con el buff
  // activo no cobra nada — es lo que hace que el golpe de fuego salga en
  // cada latigazo mientras dura.
  spendEnergy(cost) {
    if (this.unlimited) return;
    this.energy = Math.max(0, this.energy - cost);
  }

  updateEnergy(dt, wantBoost) {
    const B = CFG.boost;
    if (this.energyPulse > 0) this.energyPulse = Math.max(0, this.energyPulse - dt * 2.4);
    if (this.unlimitedT > 0) {
      this.unlimitedT -= dt;
      this.energy = B.max;      // el frasco se mantiene lleno solo
    }
    const can = this.energy > 0 && (this.broom.boosting || this.energy >= B.minToStart);
    const active = wantBoost && can && this.control.thrust;
    if (active && !this.unlimited) this.energy = clamp(this.energy - B.drain * dt, 0, B.max);
    this.control.boost = active;
    return active;
  }

  // target = { ball: {x,y}, aim: {x,y} } — lo usa el golpe dirigido para saber
  // dónde está la pelota y hacia dónde mandarla.
  update(dt, frozen = false, target = null) {
    if (this.ramCd > 0) this.ramCd -= dt;
    if (frozen) {
      // Cuenta regresiva: la escoba queda CLAVADA en su saque. Antes acá se
      // integraba la posición con un amortiguado de 0.85 por paso, y eso era
      // el bug de "a veces arranca en otro lado": tras la explosión del gol un
      // mago sale a miles de u/s, y aunque el amortiguado frena rápido, en los
      // ~1.4 s de countdown alcanzaba a recorrer cientos de píxeles. El reset
      // lo dejaba bien y el countdown lo mandaba de paseo. Fijarlo es además
      // lo correcto: el saque tiene que ser idéntico siempre, no depender de
      // con cuánta violencia terminó el punto anterior.
      this.broom.pos.x = this.spawn.x;
      this.broom.pos.y = this.spawn.y;
      this.broom.vel.x = 0;
      this.broom.vel.y = 0;
      this.broom.angVel = 0;
      // El ángulo vuelve al del saque de forma suave: es lo único que se deja
      // animar, porque se lee como el mago acomodándose antes del pitazo.
      this.broom.angle = damp(this.broom.angle, this.spawn.angle, 9, dt);
      this.rider.update(dt, false);
      return;
    }
    this.broom.update(dt, this.control);
    this.rider.update(dt, this.control.tuck, target);
  }

  reset() {
    this.broom.reset(this.spawn.x, this.spawn.y, this.spawn.angle);
    this.rider.reset();
    this.control.thrust = false;
    this.control.brake = false;
    this.control.tuck = false;
    this.control.boost = false;
    this.ramCd = 0;
    this.energy = 0;
    this.energyPulse = 0;
    this.unlimitedT = 0;
    this.control.aim.x = this.spawn.x + Math.cos(this.spawn.angle) * 200;
    this.control.aim.y = this.spawn.y + Math.sin(this.spawn.angle) * 200;
  }
}
