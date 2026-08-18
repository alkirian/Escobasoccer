// Partículas simples: estelas de propulsión, impactos, goles.
import { rand } from './utils.js';

export class Particles {
  constructor() { this.list = []; }

  spawn(x, y, vx, vy, life, size, color, grav = 0, fade = true) {
    if (this.list.length > 600) this.list.shift();
    this.list.push({ x, y, vx, vy, life, maxLife: life, size, color, grav, fade });
  }

  thrust(x, y, dirX, dirY, power) {
    if (Math.random() > power * 0.9) return;
    const s = rand(60, 220) * power;
    this.spawn(
      x + rand(-4, 4), y + rand(-4, 4),
      -dirX * s + rand(-40, 40), -dirY * s + rand(-40, 40),
      rand(0.25, 0.6), rand(2, 5),
      Math.random() < 0.4 ? '#ffd27a' : '#a8e6ff',
      0
    );
  }

  impact(x, y, strength) {
    const n = Math.min(3 + strength / 90, 14) | 0;
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const s = rand(40, 90) + strength * 0.35;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.2, 0.5), rand(2, 4), '#fff2c8', 300);
    }
  }

  goal(x, y, color) {
    for (let i = 0; i < 90; i++) {
      const a = rand(Math.PI * 2);
      const s = rand(120, 720);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.6, 1.7), rand(2, 7),
        Math.random() < 0.5 ? color : '#ffe9a8', 420);
    }
  }

  brake(x, y, velX, velY) {
    if (Math.random() < 0.5) return;
    const s = Math.hypot(velX, velY);
    if (s < 100) return;
    this.spawn(x + rand(-14, 14), y + rand(-14, 14), velX * 0.25 + rand(-30, 30), velY * 0.25 + rand(-30, 30),
      rand(0.15, 0.35), rand(3, 7), 'rgba(200,220,255,0.5)', 0);
  }

  // Energía del orbe viajando hacia la escoba: partículas que persiguen al
  // jugador en vez de dispersarse, para que se lea como "absorción".
  orbAbsorb(ox, oy, target, color) {
    for (let i = 0; i < 16; i++) {
      const a = rand(Math.PI * 2), s = rand(40, 190);
      this.list.push({
        x: ox + Math.cos(a) * rand(4, 22), y: oy + Math.sin(a) * rand(4, 22),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.28, 0.5), maxLife: 0.5, size: rand(2.5, 5.5),
        color: Math.random() < 0.5 ? color : '#ffffff', grav: 0, fade: true,
        seek: target, seekK: rand(26, 46),
      });
    }
  }

  // Chispa mágica de la escoba: escala con la velocidad, de chispita a estela
  magicTrail(x, y, dirX, dirY, power, boost, color) {
    if (Math.random() > 0.25 + power * 0.75) return;
    const s = rand(70, 300) * (0.5 + power);
    const spread = 45 + boost * 90;
    this.spawn(
      x + rand(-5, 5), y + rand(-5, 5),
      -dirX * s + rand(-spread, spread), -dirY * s + rand(-spread, spread),
      rand(0.25, 0.55) + boost * 0.25, rand(2, 4) + boost * 3.5,
      boost > 0.35 ? (Math.random() < 0.55 ? color : '#fff2c8') : (Math.random() < 0.4 ? '#ffd27a' : '#a8e6ff'),
      0,
    );
  }

  // Onda expansiva del gol: anillo de chispas hacia afuera
  shockwave(x, y, color, n = 70) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
      const s = rand(520, 1150);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
        rand(0.5, 1.0), rand(2.5, 6), Math.random() < 0.5 ? color : '#fff2c8', 220);
    }
  }

  // Pelota en llamas: ascuas que quedan atrás y se apagan de amarillo a rojo
  // a humo. Se emiten desde detrás de la pelota (contra su velocidad) para que
  // se lea como una estela y no como una nube alrededor.
  fireTrail(x, y, vx, vy, intensity) {
    const n = 1 + (Math.random() < intensity ? 1 : 0);
    const sp = Math.hypot(vx, vy) || 1;
    for (let i = 0; i < n; i++) {
      const back = rand(0.05, 0.25);
      const color = Math.random() < 0.45 ? '#fff3b0'
        : Math.random() < 0.6 ? '#ffab2e' : '#ff5a1f';
      this.spawn(
        x + rand(-9, 9), y + rand(-9, 9),
        -vx * back + rand(-70, 70), -vy * back + rand(-70, 70) - rand(20, 90),
        rand(0.3, 0.75), rand(4, 11) * (0.6 + intensity * 0.6), color,
        -140, // ascuas: suben mientras se apagan
      );
    }
    // chispa blanca ocasional al frente, donde "arde" más
    if (Math.random() < intensity * 0.35) {
      this.spawn(x + vx / sp * 12, y + vy / sp * 12, rand(-60, 60), rand(-60, 60),
        rand(0.12, 0.26), rand(3, 6), '#ffffff', 0);
    }
  }

  // El orbe fugitivo se materializa (o se desvanece): anillo dorado
  runnerBurst(x, y) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rand(-0.1, 0.1);
      const s = rand(160, 460);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
        rand(0.4, 0.9), rand(3, 7), Math.random() < 0.6 ? '#ffd76a' : '#fff6d8', 0);
    }
  }

  // Atrapado: la energía dorada se vuelca dentro del jugador
  runnerCatch(x, y, target) {
    for (let i = 0; i < 46; i++) {
      const a = rand(Math.PI * 2), s = rand(70, 320);
      this.list.push({
        x: x + Math.cos(a) * rand(6, 34), y: y + Math.sin(a) * rand(6, 34),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.35, 0.7), maxLife: 0.7, size: rand(3, 7),
        color: Math.random() < 0.55 ? '#ffd76a' : '#ffffff', grav: 0, fade: true,
        seek: target, seekK: rand(30, 55),
      });
    }
  }

  // Aura mientras dura la energía ilimitada: chispitas doradas subiendo
  unlimitedAura(x, y) {
    if (Math.random() > 0.35) return;
    this.spawn(x + rand(-34, 34), y + rand(-30, 30),
      rand(-40, 40), rand(-120, -40), rand(0.3, 0.6), rand(2, 5),
      Math.random() < 0.5 ? '#ffd76a' : '#fff6d8', -60);
  }

  // Esfuerzo / raspado al quedar clavado en una superficie
  scrape(x, y, nx, ny, intensity) {
    if (Math.random() > intensity * 0.7) return;
    const a = Math.atan2(ny, nx) + rand(-0.9, 0.9);
    const s = rand(60, 240) * intensity;
    this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
      rand(0.2, 0.45), rand(2, 4), Math.random() < 0.5 ? '#ffd08a' : '#cfc7b4', 420);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      // Las partículas con "seek" son atraídas por el jugador: eso convierte
      // un estallido genérico en una absorción legible.
      if (p.seek) {
        p.vx += (p.seek.x - p.x) * p.seekK * dt;
        p.vy += (p.seek.y - p.y) * p.seekK * dt;
        p.vx *= 0.9; p.vy *= 0.9;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = p.fade ? t : 1;
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + t * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
}
