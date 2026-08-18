// Jugador = escoba + jinete + control (humano o bot)
import { Broom } from './broom.js';
import { Rider } from './rider.js';
import { CFG } from './config.js';
import { clamp } from './utils.js';

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
  }

  // Energía: la suman los orbes, la gasta el boost. Solo se puede arrancar
  // el boost con algo de reserva, para que no sea un parpadeo constante.
  addEnergy(amount) {
    this.energy = clamp(this.energy + amount, 0, CFG.boost.max);
    this.energyPulse = 1;
  }

  updateEnergy(dt, wantBoost) {
    const B = CFG.boost;
    if (this.energyPulse > 0) this.energyPulse = Math.max(0, this.energyPulse - dt * 2.4);
    const can = this.energy > 0 && (this.broom.boosting || this.energy >= B.minToStart);
    const active = wantBoost && can && this.control.thrust;
    if (active) this.energy = clamp(this.energy - B.drain * dt, 0, B.max);
    this.control.boost = active;
    return active;
  }

  // target = { ball: {x,y}, aim: {x,y} } — lo usa el golpe dirigido para saber
  // dónde está la pelota y hacia dónde mandarla.
  update(dt, frozen = false, target = null) {
    if (this.ramCd > 0) this.ramCd -= dt;
    if (frozen) {
      // Cuenta regresiva: la escoba se mantiene en posición, el cuerpo se acomoda
      this.broom.vel.x *= 0.85;
      this.broom.vel.y *= 0.85;
      this.broom.angVel *= 0.85;
      this.broom.pos.x += this.broom.vel.x * dt;
      this.broom.pos.y += this.broom.vel.y * dt;
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
    this.control.aim.x = this.spawn.x + Math.cos(this.spawn.angle) * 200;
    this.control.aim.y = this.spawn.y + Math.sin(this.spawn.angle) * 200;
  }
}
