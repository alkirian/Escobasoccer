// La pelota: completamente física, grande y legible.
import { CFG } from './config.js';
import { clamp } from './utils.js';

export class Ball {
  constructor(x, y) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.r = CFG.ball.r;
    this.spin = 0;       // solo visual
    this.rot = 0;
    this.trail = [];
    this.scale = 1;      // para animación de gol (succión al portal)
    this.frozen = false;
    // Fuego: lo prende un golpe cargado con media reserva o más. Es puramente
    // expresivo (la potencia ya se aplicó al impulso), pero es la señal de
    // "esto viene con todo" que se lee de un vistazo desde el otro arco.
    this.fire = 0;       // 0..1, intensidad actual
    this.fireT = 0;
  }

  ignite() {
    this.fireT = CFG.ball.fireTime;
    this.fire = 1;
  }

  update(dt) {
    if (this.frozen) return;
    const B = CFG.ball;
    this.vel.y += B.gravity * dt;
    const sp = Math.hypot(this.vel.x, this.vel.y);
    const f = Math.exp(-(B.dragLin + B.dragQuad * sp) * dt);
    this.vel.x *= f;
    this.vel.y *= f;
    if (sp > B.maxSpeed) {
      this.vel.x *= B.maxSpeed / sp;
      this.vel.y *= B.maxSpeed / sp;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.spin = clamp(this.vel.x / 60, -12, 12);
    this.rot += this.spin * dt;

    if (this.fireT > 0) {
      this.fireT -= dt;
      this.fire = clamp(this.fireT / CFG.ball.fireTime, 0, 1);
    } else {
      this.fire = 0;
    }

    // Estela. Se guarda la velocidad además de la posición porque el render
    // dibuja una CINTA (un polígono que sigue el camino) en vez de una fila de
    // círculos: para darle ancho necesita saber hacia dónde iba la pelota en
    // cada punto. Con 26 muestras la cinta es continua incluso a máxima
    // velocidad — con 18 se veía a tramos.
    this.trail.push({
      x: this.pos.x, y: this.pos.y, sp, fire: this.fire,
      vx: this.vel.x, vy: this.vel.y,
    });
    if (this.trail.length > 26) this.trail.shift();
  }

  kick(ix, iy) {
    this.vel.x += ix;
    this.vel.y += iy;
  }

  reset(x, y) {
    this.pos.x = x; this.pos.y = y;
    this.vel.x = 0; this.vel.y = 0;
    this.trail.length = 0;
    this.scale = 1;
    this.frozen = false;
    this.rot = 0;
    this.fire = 0;
    this.fireT = 0;
  }
}
