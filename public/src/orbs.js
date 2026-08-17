// Orbes de energía — el recurso mágico del juego.
// Repartidos por la arena: los del centro caen sobre la ruta directa a la
// pelota, los de los costados obligan a desviarse. Ahí está la decisión
// estratégica: ir por la pelota, o cargar energía para la próxima jugada.
import { CFG } from './config.js';
import { clamp } from './utils.js';

export class Orb {
  constructor(x, y, phase) {
    this.x = x;
    this.y = y;
    this.phase = phase;   // desfase del flotar, para que no laten todos igual
    this.alive = true;
    this.respawnT = 0;
    this.fade = 1;        // 0..1, animación de regreso
    this.pop = 0;         // destello al ser recogido
  }

  // Posición con el flotar aplicado (la usa la colisión y el render)
  get fx() { return this.x; }
  get fy() {
    const O = CFG.orbs;
    return this.y + Math.sin(this.phase) * O.bobAmp;
  }
}

export class OrbField {
  constructor() {
    this.orbs = [];
    this.rebuild();
  }

  // Reconstruye desde CFG.orbs.layout. Las posiciones son fracciones del
  // área jugable, así que cambiar de mapa no rompe la distribución.
  rebuild() {
    const A = CFG.arena;
    const cx = (A.L + A.R) / 2, cy = (A.T + A.B) / 2;
    const hw = (A.R - A.L) / 2, hh = (A.B - A.T) / 2;
    this.orbs = CFG.orbs.layout.map((p, i) => new Orb(
      cx + p.x * hw,
      cy + p.y * hh,
      i * 1.7,
    ));
  }

  reset() {
    for (const o of this.orbs) {
      o.alive = true;
      o.respawnT = 0;
      o.fade = 1;
      o.pop = 0;
    }
  }

  update(dt) {
    const O = CFG.orbs;
    for (const o of this.orbs) {
      o.phase += O.bobSpeed * dt;
      if (o.pop > 0) o.pop = Math.max(0, o.pop - dt * 3);
      if (o.alive) {
        // Regreso gradual: el orbe se materializa, se puede anticipar
        if (o.fade < 1) o.fade = clamp(o.fade + dt / O.fadeIn, 0, 1);
      } else {
        o.respawnT -= dt;
        if (o.respawnT <= 0) { o.alive = true; o.fade = 0; }
      }
    }
  }

  // Recolección: al atravesar el orbe se absorbe entero, al instante.
  // onCollect(orbe, jugador) → efectos y energía.
  collect(players, onCollect) {
    const O = CFG.orbs;
    for (const o of this.orbs) {
      if (!o.alive || o.fade < 0.55) continue; // aún materializándose
      const oy = o.fy;
      for (const p of players) {
        if (!p) continue;
        const b = p.broom.pos;
        if (Math.hypot(b.x - o.fx, b.y - oy) > O.pickupR) continue;
        o.alive = false;
        o.respawnT = O.respawn;
        o.pop = 1;
        onCollect?.(o, p, oy);
        break;
      }
    }
  }
}
