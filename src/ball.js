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

    this.trail.push({ x: this.pos.x, y: this.pos.y, sp });
    if (this.trail.length > 18) this.trail.shift();
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
  }
}
