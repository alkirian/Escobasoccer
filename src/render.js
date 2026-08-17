// Render 2.5D: el mapa ES la imagen "1 mapa.jpeg", dibujada dentro de la
// transformación de mundo para que arte y física queden alineados 1:1.
// Los personajes salen del ragdoll físico y proyectan sombra en el césped.
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { clamp, lerp } from './utils.js';

export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.t = 0;

    this.mapImg = new Image();
    this.mapReady = false;
    this.mapImg.onload = () => { this.mapReady = true; };
    this.mapImg.src = CFG.arena.src;
  }

  draw(world, dtFrame) {
    this.t += dtFrame;
    const ctx = this.ctx;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;

    // Fuera del mapa: negro de sala, para que el encuadre no distraiga.
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#08061a';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    world.camera.applyTransform(ctx);

    this._map(ctx);
    this._portalAura(ctx, -1, world);
    this._portalAura(ctx, 1, world);
    this._shadows(ctx, world);
    if (world.orbs) this._orbs(ctx, world.orbs);

    world.particles.draw(ctx);

    this._ballTrail(ctx, world.ball);
    if (world.playerB) this._player(ctx, world.playerB, CFG.colors.p2, CFG.colors.p2Dark, world);
    this._player(ctx, world.playerA, CFG.colors.p1, CFG.colors.p1Dark, world);
    this._ball(ctx, world.ball);

    if (world.debug) this._debug(ctx, world);
    ctx.restore();

    this._aimIndicator(ctx, world);
    this._hud(ctx, world, W, H);
  }

  // ---------- MAPA ----------
  // La imagen se dibuja DENTRO de la transformación de mundo, a tamaño
  // natural y centrada en el origen. Por eso el mundo usa píxeles de la
  // imagen: cada muro pintado cae exactamente sobre su límite físico.
  _map(ctx) {
    const { imgW, imgH } = CFG.arena;
    if (this.mapReady) {
      ctx.drawImage(this.mapImg, -imgW / 2, -imgH / 2, imgW, imgH);
    } else {
      const g = ctx.createLinearGradient(0, -imgH / 2, 0, imgH / 2);
      g.addColorStop(0, '#0b0a24');
      g.addColorStop(1, '#2c1a4e');
      ctx.fillStyle = g;
      ctx.fillRect(-imgW / 2, -imgH / 2, imgW, imgH);
    }
  }

  // Los arcos rúnicos ya están pintados en la imagen: acá sólo se agrega el
  // aura de equipo, para que siga siendo obvio de un vistazo qué portal es
  // de quién sin repintar arte encima del arte.
  _portalAura(ctx, side, world) {
    const { portalR } = CFG.arena;
    const c = portalCenter(side);
    const color = side === -1 ? CFG.colors.p1 : CFG.colors.p2;
    const glow = side === -1 ? CFG.colors.p1Glow : CFG.colors.p2Glow;
    let pulse = 0.5 + 0.5 * Math.sin(this.t * 1.8 + side * 10);

    // El portal está vivo: se agita cuando la pelota se le acerca, y durante
    // un gol acumula energía antes de reventar.
    let charge = 0;
    if (world?.ball) {
      const d = Math.hypot(world.ball.pos.x - c.x, world.ball.pos.y - c.y);
      charge = clamp(1 - d / (portalR * 4), 0, 1);
    }
    const m = world?.match;
    const goaling = m && m.state === 'goal' && m.goalSide === side;
    if (goaling) {
      charge = m.blasted ? 1 : 1 - clamp(m.blastT / CFG.goalBlast.charge, 0, 1);
      pulse = 1;
    }
    const excite = Math.max(charge, goaling ? 1 : 0);

    ctx.save();
    ctx.translate(c.x, c.y);

    // Onda expansiva del gol: anillo que se abre y se disipa
    if (goaling && m.blasted && m.blastWave < 1) {
      const wv = m.blastWave;
      ctx.save();
      ctx.globalAlpha = (1 - wv) * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 26 * (1 - wv) + 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 40;
      ctx.beginPath();
      ctx.arc(0, 0, wv * CFG.goalBlast.radius, 0, 7);
      ctx.stroke();
      ctx.globalAlpha = (1 - wv) * 0.45;
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = 8 * (1 - wv) + 2;
      ctx.beginPath();
      ctx.arc(0, 0, wv * CFG.goalBlast.radius * 0.72, 0, 7);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // halo que respira, dentro del hueco del arco
    const haloR = portalR * (1.15 + excite * 0.9);
    const g = ctx.createRadialGradient(0, 0, portalR * 0.1, 0, 0, haloR);
    g.addColorStop(0, glow);
    g.addColorStop(0.55, glow.replace(/[\d.]+\)$/, '0.18)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (0.55 + pulse * 0.3) * (1 + excite * 0.6);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, haloR * 0.54, haloR, 0, 0, 7);
    ctx.fill();

    // borde luminoso siguiendo el óvalo del arco
    ctx.globalAlpha = 0.35 + pulse * 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5 + excite * 6;
    if (excite > 0.2) { ctx.shadowColor = color; ctx.shadowBlur = 14 * excite; }
    ctx.beginPath();
    ctx.ellipse(0, 0, portalR * 0.5, portalR * 0.94, 0, 0, 7);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // energía girando adentro: se acelera cuando la pelota se acerca
    const swirl = 1 + excite * 3.5;
    ctx.globalAlpha = 0.3 + excite * 0.45;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const a0 = this.t * swirl * (0.7 + i * 0.4) * side + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, portalR * (0.2 + i * 0.13), portalR * (0.36 + i * 0.24),
        0, a0, a0 + 2.4);
      ctx.stroke();
    }

    // ascuas subiendo por el hueco
    ctx.fillStyle = color;
    const embers = 5 + Math.round(excite * 9);
    for (let i = 0; i < embers; i++) {
      const ph = (this.t * (0.35 + excite * 1.2) + i / embers) % 1;
      const ey = portalR * 0.9 - ph * portalR * 1.8;
      const ex = Math.sin(this.t * 1.1 + i * 2.2) * portalR * 0.3;
      ctx.globalAlpha = (0.55 + excite * 0.35) * Math.sin(ph * Math.PI);
      ctx.beginPath();
      ctx.arc(ex, ey, 3.5 + excite * 2, 0, 7);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- ORBES ----------
  // Flotan, rotan, iluminan y sueltan chispas. Cuando están por volver se
  // materializan gradualmente, para poder anticipar el regreso.
  _orbs(ctx, field) {
    const O = CFG.orbs;
    for (const o of field.orbs) {
      const x = o.fx, y = o.fy;

      // Fantasma del respawn: marca dónde va a volver y cuánto falta
      if (!o.alive) {
        const left = o.respawnT / O.respawn;
        ctx.globalAlpha = 0.13;
        ctx.strokeStyle = '#9fe6ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, O.r * 1.5, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, O.r * 1.5, -Math.PI / 2, -Math.PI / 2 + (1 - left) * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      const f = o.fade;
      const r = O.r * (0.25 + 0.75 * f) * (1 + o.pop * 0.8);
      const spin = this.t * 1.7 + o.phase;

      ctx.save();
      ctx.globalAlpha = f;
      // halo
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3.4);
      g.addColorStop(0, 'rgba(150,235,255,0.55)');
      g.addColorStop(0.4, 'rgba(110,190,255,0.18)');
      g.addColorStop(1, 'rgba(90,160,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, 7); ctx.fill();

      // anillo rúnico girando
      ctx.strokeStyle = 'rgba(180,245,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 0.62, spin * 0.6, 0, 7);
      ctx.stroke();

      // núcleo
      const cg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.45, '#bdf0ff');
      cg.addColorStop(1, '#3fa8e8');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();

      // chispitas orbitando
      for (let i = 0; i < 3; i++) {
        const a = spin * 1.5 + i * 2.09;
        const rr = r * (1.9 + 0.35 * Math.sin(spin * 2 + i));
        ctx.fillStyle = 'rgba(220,250,255,0.9)';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55, 2, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- SOMBRAS ----------
  // Todo lo que vuela proyecta sombra sobre el césped: es la única pista
  // visual de "a qué altura estoy" en una vista lateral, y ancla a los
  // personajes al piso pintado en vez de dejarlos flotando pegados encima.
  _shadows(ctx, world) {
    for (const pl of [world.playerA, world.playerB].filter(Boolean)) {
      const p = pl.rider.points;
      this._groundShadow(ctx, pl.broom.pos.x, pl.broom.pos.y, 62);
      this._groundShadow(ctx, p.pelvis.x, p.pelvis.y, 26);
    }
    this._groundShadow(ctx, world.ball.pos.x, world.ball.pos.y, world.ball.r * 1.05);
  }

  _groundShadow(ctx, x, y, baseR) {
    const { T, B } = CFG.arena;
    // 0 = tocando el césped, 1 = arriba del todo
    const h = clamp((B - y) / (B - T), 0, 1);
    const alpha = 0.5 * Math.pow(1 - h, 1.25);
    if (alpha < 0.012) return;
    const rx = baseR * (1 + h * 1.5);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#0a0616';
    ctx.beginPath();
    ctx.ellipse(x, B, rx, rx * 0.26, 0, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------- PERSONAJES ----------
  _player(ctx, player, color, dark, world) {
    const r = player.rider;
    // La previsualización de puntería es solo para el jugador humano
    const human = world && player === world.playerA && !world.botsMode;
    const p = r.points;
    const b = player.broom;

    // Estela del latigazo: el arco que barren los pies (detrás de todo)
    if (r.footTrail.length > 2) {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      for (let i = 1; i < r.footTrail.length; i++) {
        const t = i / r.footTrail.length;
        ctx.globalAlpha = t * 0.5;
        ctx.lineWidth = 2 + t * 7;
        ctx.beginPath();
        ctx.moveTo(r.footTrail[i - 1].x, r.footTrail[i - 1].y);
        ctx.lineTo(r.footTrail[i].x, r.footTrail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Indicador de carga: sin esto el jugador no sabe que el golpe está listo
    const charge = r.chargeAmount();
    if (charge > 0) {
      const ready = charge >= 1;
      ctx.save();
      ctx.translate(b.pos.x, b.pos.y);
      ctx.strokeStyle = ready ? '#ffd76a' : color;
      ctx.globalAlpha = ready ? 0.55 + 0.35 * Math.sin(this.t * 14) : 0.5;
      ctx.lineWidth = ready ? 5 : 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 74, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // Previsualización del golpe dirigido: si la pelota está en rango,
      // se muestra el rango y la línea hacia donde va a salir. Es lo que
      // hace que el jugador entienda que apunta con el mouse.
      if (ready && human) {
        const ball = world.ball;
        const shown = CFG.whip.range * CFG.whip.shownRange;
        const inRange = Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) <= shown;
        ctx.save();
        ctx.setLineDash([9, 11]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = inRange ? 'rgba(255,215,106,0.55)' : 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, shown, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
        if (inRange) {
          const aim = player.control.aim;
          let dx = aim.x - ball.pos.x, dy = aim.y - ball.pos.y;
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl; dy /= dl;
          ctx.strokeStyle = '#ffd76a';
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(ball.pos.x, ball.pos.y);
          ctx.lineTo(ball.pos.x + dx * 240, ball.pos.y + dy * 240);
          ctx.stroke();
          // punta de flecha
          ctx.beginPath();
          ctx.moveTo(ball.pos.x + dx * 240, ball.pos.y + dy * 240);
          ctx.lineTo(ball.pos.x + dx * 214 - dy * 15, ball.pos.y + dy * 214 + dx * 15);
          ctx.lineTo(ball.pos.x + dx * 214 + dy * 15, ball.pos.y + dy * 214 - dx * 15);
          ctx.closePath();
          ctx.fillStyle = '#ffd76a';
          ctx.fill();
          // resalte de la pelota como blanco válido
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 10);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(ball.pos.x, ball.pos.y, ball.r + 12, 0, 7);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // Capa (detrás de todo)
    ctx.beginPath();
    ctx.moveTo(r.cape[0].x, r.cape[0].y);
    for (let i = 1; i < r.cape.length; i++) {
      const w = 12 - i * 1.5;
      ctx.lineTo(r.cape[i].x, r.cape[i].y + w);
    }
    for (let i = r.cape.length - 1; i >= 0; i--) {
      const w = 12 - i * 1.5;
      ctx.lineTo(r.cape[i].x, r.cape[i].y - w);
    }
    ctx.closePath();
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Pierna trasera (más oscura → profundidad)
    this._limb(ctx, p.pelvis, p.kneeB, p.footB, 9, this._shade(dark, -15));
    // Brazo trasero
    this._limbSeg(ctx, p.chest, p.handB, 8, this._shade(dark, -10));

    // Escoba
    this._broom(ctx, b, player);

    // Pierna delantera
    this._limb(ctx, p.pelvis, p.kneeF, p.footF, 10, dark);

    // Torso (túnica): trapecio pelvis→pecho
    this._torso(ctx, p.pelvis, p.chest, color, dark);

    // Brazo delantero
    this._limbSeg(ctx, p.chest, p.handF, 9, color);

    // Manos (siempre en el palo)
    ctx.fillStyle = CFG.colors.skin;
    ctx.beginPath(); ctx.arc(p.handF.x, p.handF.y, 5.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(p.handB.x, p.handB.y, 5, 0, 7); ctx.fill();

    // Cabeza + sombrero
    this._head(ctx, p.head, p.chest, color, dark);
  }

  _shade(hex, amt) {
    // oscurecer/aclarar un color hex simple
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  _limb(ctx, a, m, b, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(m.x, m.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // botita
    ctx.fillStyle = '#2b2438';
    ctx.beginPath(); ctx.arc(b.x, b.y, w * 0.65, 0, 7); ctx.fill();
  }

  _limbSeg(ctx, a, b, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  _torso(ctx, pelvis, chest, color, dark) {
    const dx = chest.x - pelvis.x, dy = chest.y - pelvis.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    ctx.beginPath();
    ctx.moveTo(chest.x + nx * 10, chest.y + ny * 10);
    ctx.lineTo(chest.x - nx * 10, chest.y - ny * 10);
    // faldón acampanado en la pelvis
    ctx.lineTo(pelvis.x - nx * 15, pelvis.y - ny * 15);
    ctx.lineTo(pelvis.x + nx * 15, pelvis.y + ny * 15);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // cinturón
    ctx.strokeStyle = dark;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const bx = lerp(pelvis.x, chest.x, 0.25), by = lerp(pelvis.y, chest.y, 0.25);
    ctx.moveTo(bx + nx * 13, by + ny * 13);
    ctx.lineTo(bx - nx * 13, by - ny * 13);
    ctx.stroke();
  }

  _head(ctx, head, chest, color, dark) {
    // orientación: vector pecho→cabeza = "arriba" del personaje
    let ux = head.x - chest.x, uy = head.y - chest.y;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    const px = -uy, py = ux; // perpendicular

    // cara
    ctx.fillStyle = CFG.colors.skin;
    ctx.beginPath(); ctx.arc(head.x, head.y, 11, 0, 7); ctx.fill();

    // barba pequeña
    ctx.fillStyle = '#ddd6c8';
    ctx.beginPath();
    ctx.arc(head.x - ux * 6, head.y - uy * 6, 6, 0, 7);
    ctx.fill();

    // sombrero de mago: ala + cono torcido
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(head.x + ux * 7, head.y + uy * 7, 16, 5, Math.atan2(py, px), 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(head.x + ux * 8 + px * 10, head.y + uy * 8 + py * 10);
    ctx.lineTo(head.x + ux * 8 - px * 10, head.y + uy * 8 - py * 10);
    ctx.lineTo(head.x + ux * 30 - px * 6, head.y + uy * 30 - py * 6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // banda
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(head.x + ux * 9 + px * 9, head.y + uy * 9 + py * 9);
    ctx.lineTo(head.x + ux * 9 - px * 9, head.y + uy * 9 - py * 9);
    ctx.stroke();
  }

  _broom(ctx, b, player) {
    const tip = b.tip(), tail = b.tail();
    const d = b.dir();

    // palo
    ctx.strokeStyle = CFG.colors.wood;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tail.x + d.x * 14, tail.y + d.y * 14);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = CFG.colors.woodDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tail.x + d.x * 14, tail.y + d.y * 14 - 2);
    ctx.lineTo(tip.x, tip.y - 2);
    ctx.stroke();

    // ramas (abanico en la cola, tiemblan al acelerar)
    const jitter = b.thrustPower * 2.5;
    ctx.strokeStyle = CFG.colors.straw;
    ctx.lineWidth = 3;
    for (let i = -3; i <= 3; i++) {
      const a = b.angle + Math.PI + i * 0.13 + Math.sin(this.t * 30 + i * 5) * 0.03 * jitter;
      ctx.beginPath();
      ctx.moveTo(tail.x + d.x * 16, tail.y + d.y * 16);
      ctx.lineTo(tail.x + d.x * 16 + Math.cos(a) * (30 + Math.abs(i) * -2), tail.y + d.y * 16 + Math.sin(a) * (30 + Math.abs(i) * -2));
      ctx.stroke();
    }
    // atadura
    ctx.strokeStyle = '#7a4a20';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tail.x + d.x * 12 - d.y * 6, tail.y + d.y * 12 + d.x * 6);
    ctx.lineTo(tail.x + d.x * 12 + d.y * 6, tail.y + d.y * 12 - d.x * 6);
    ctx.stroke();

    // resplandor de propulsión
    if (b.thrustPower > 0.05) {
      const rad = 42 + b.boostPower * 40;
      const g = ctx.createRadialGradient(tail.x, tail.y, 2, tail.x, tail.y, rad);
      const boost = b.boostPower;
      g.addColorStop(0, `rgba(${160 + boost * 95},${220 - boost * 60},${255 - boost * 160},${(0.5 + boost * 0.4) * b.thrustPower})`);
      g.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(tail.x, tail.y, rad, 0, 7); ctx.fill();
    }

    // A mucha velocidad el palo se ve cargado de magia: runas corriendo por
    // la madera y un halo a lo largo. Se reserva para velocidades altas.
    const speed = Math.hypot(b.vel.x, b.vel.y);
    const charge = clamp((speed - 620) / 700, 0, 1) * 0.55 + b.boostPower * 0.45;
    if (charge > 0.06) {
      ctx.save();
      ctx.globalAlpha = charge * 0.85;
      ctx.strokeStyle = b.boostPower > 0.3 ? '#ffd76a' : '#9fe6ff';
      ctx.lineWidth = 3 + charge * 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10 + charge * 14;
      ctx.beginPath();
      ctx.moveTo(tail.x + d.x * 16, tail.y + d.y * 16);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // runas corriendo hacia la punta
      for (let i = 0; i < 4; i++) {
        const ph = (this.t * (1.6 + charge * 2.6) + i * 0.25) % 1;
        const px = tail.x + d.x * (16 + ph * 94), py = tail.y + d.y * (16 + ph * 94);
        ctx.globalAlpha = charge * Math.sin(ph * Math.PI);
        ctx.fillStyle = '#fff6d8';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Vibración del esfuerzo al estar clavada (se dibuja como temblor extra)
    if (b.strain > 0.15) {
      ctx.save();
      ctx.globalAlpha = b.strain * 0.5;
      ctx.strokeStyle = '#ffd08a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 10 + Math.sin(this.t * 40) * 3 * b.strain, 0, 7);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- PELOTA ----------
  _ballTrail(ctx, ball) {
    if (ball.trail.length < 2) return;
    for (let i = 1; i < ball.trail.length; i++) {
      const t = i / ball.trail.length;
      const a = ball.trail[i];
      ctx.globalAlpha = t * 0.25 * Math.min(a.sp / 700, 1);
      ctx.fillStyle = CFG.colors.ballGlow;
      ctx.beginPath();
      ctx.arc(a.x, a.y, ball.r * t * 0.9, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _ball(ctx, ball) {
    const r = ball.r * ball.scale;
    if (r < 1) return;
    ctx.save();
    ctx.translate(ball.pos.x, ball.pos.y);

    // glow
    const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2);
    g.addColorStop(0, CFG.colors.ballGlow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, 7); ctx.fill();

    ctx.rotate(ball.rot);
    // cuerpo
    const bg = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.15, 0, 0, r);
    bg.addColorStop(0, '#fdf8e8');
    bg.addColorStop(0.6, CFG.colors.ball);
    bg.addColorStop(1, '#b3a67e');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();

    // runa (marca la rotación)
    ctx.strokeStyle = '#8a7440';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, 7);
    ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0);
    ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- INDICADOR DE APUNTADO ----------
  _aimIndicator(ctx, world) {
    if (world.botsMode) return;
    const cur = world.input.cursor;
    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 9, 0, 7);
    ctx.moveTo(cur.x - 14, cur.y); ctx.lineTo(cur.x - 5, cur.y);
    ctx.moveTo(cur.x + 5, cur.y); ctx.lineTo(cur.x + 14, cur.y);
    ctx.moveTo(cur.x, cur.y - 14); ctx.lineTo(cur.x, cur.y - 5);
    ctx.moveTo(cur.x, cur.y + 5); ctx.lineTo(cur.x, cur.y + 14);
    ctx.stroke();
    ctx.fillStyle = CFG.colors.p1;
    ctx.beginPath(); ctx.arc(cur.x, cur.y, 2.2, 0, 7); ctx.fill();
  }

  // ---------- HUD ----------
  _hud(ctx, world, W, H) {
    const m = world.match;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Modo práctica: sin marcador ni reloj, solo lo necesario para probar
    if (world.practice) {
      this._practiceHud(ctx, world, W, H);
      return;
    }

    const cx = W / 2;
    this._scoreboard(ctx, world, m, cx);
    this._energyVial(ctx, world, W, H);

    // Cuenta regresiva
    if (m.state === 'countdown') {
      const c = Math.ceil(m.countT);
      ctx.font = 'bold 120px Georgia, serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.shadowColor = 'rgba(120,180,255,0.8)';
      ctx.shadowBlur = 30;
      ctx.fillText(m.countT > 0.35 ? (c > 3 ? '' : c) : '', cx, H * 0.4);
      ctx.shadowBlur = 0;
    } else if (m.state === 'play' && m.timeLeft > this.durationMinusYa(m) && !m.golden) {
      // "¡YA!" breve al iniciar
      ctx.font = 'bold 110px Georgia, serif';
      ctx.fillStyle = 'rgba(255,235,150,0.9)';
      ctx.shadowColor = 'rgba(255,200,80,0.8)';
      ctx.shadowBlur = 30;
      ctx.fillText('¡YA!', cx, H * 0.4);
      ctx.shadowBlur = 0;
    }

    // GOL — el texto entra con el estallido, no antes
    if (m.state === 'goal' && m.blasted) {
      const scorerColor = m.goalScorer === 'p1' ? CFG.colors.p1 : CFG.colors.p2;
      const age = clamp(m.blastWave * 1.6, 0, 1);
      const scale = 1.45 - 0.45 * age;   // golpe de escala al aparecer
      ctx.save();
      ctx.translate(cx, H * 0.36);
      ctx.scale(scale, scale);
      // destello blanco detrás del texto, muy breve
      ctx.globalAlpha = (1 - age) * 0.55;
      ctx.fillStyle = '#fff6d8';
      ctx.fillText('¡GOOOL!', 0, 0);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 132px Georgia, serif';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#1a1533';
      ctx.strokeText('¡GOOOL!', 0, 0);
      ctx.fillStyle = scorerColor;
      ctx.shadowColor = scorerColor;
      ctx.shadowBlur = 46;
      ctx.fillText('¡GOOOL!', 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
      ctx.font = '25px Georgia, serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const who = m.goalScorer === 'p1' ? (world.botsMode ? 'del bot azul' : 'tuyo') : (world.botsMode ? 'del bot rojo' : 'del rival');
      ctx.fillText(`Gol ${who}`, cx, H * 0.36 + 92);
    }

    // Final
    if (m.state === 'end') {
      ctx.fillStyle = 'rgba(5,4,15,0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 92px Georgia, serif';
      if (world.botsMode) {
        ctx.fillStyle = m.winner === 'p1' ? CFG.colors.p1 : CFG.colors.p2;
        ctx.fillText(m.winner === 'p1' ? 'GANA AZUL' : 'GANA ROJO', cx, H * 0.36);
      } else if (m.winner === 'p1') {
        ctx.fillStyle = '#ffd76a';
        ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 40;
        ctx.fillText('¡VICTORIA!', cx, H * 0.36);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#b08cff';
        ctx.fillText('DERROTA', cx, H * 0.36);
      }
      ctx.font = 'bold 44px Georgia, serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(`${m.score.p1}  —  ${m.score.p2}`, cx, H * 0.36 + 76);
      ctx.font = '24px Georgia, serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      const pulse = 0.5 + 0.35 * Math.sin(this.t * 4);
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.fillText('Click o ENTER para jugar otra', cx, H * 0.36 + 140);
      ctx.globalAlpha = 1;
    }

    // Tutorial progresivo
    this._hints(ctx, world, W, H);

    // Pausa
    if (world.paused) {
      ctx.fillStyle = 'rgba(5,4,15,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 64px Georgia, serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('PAUSA', cx, H * 0.42);
      ctx.font = '22px Georgia, serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('P para continuar · R reinicia el partido', cx, H * 0.42 + 60);
    }
  }

  durationMinusYa(m) { return m.duration - 0.8; }

  _practiceHud(ctx, world, W, H) {
    const cx = W / 2;
    ctx.fillStyle = 'rgba(10,8,25,0.62)';
    this._rrect(ctx, cx - 210, 12, 420, 40, 10);
    ctx.fill();
    ctx.font = '16px Georgia, serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('PRÁCTICA — sin rivales ni arcos', cx, 32);

    // Último golpe: la lectura que importa para tunear el latigazo
    const s = world.stats;
    if (s && s.lastHit > 0) {
      const age = (performance.now() - s.lastHitAt) / 1000;
      if (age < 3) {
        ctx.globalAlpha = Math.min(1, (3 - age) / 0.8);
        ctx.font = 'bold 44px Georgia, serif';
        ctx.fillStyle = s.lastAimed ? '#ffd76a' : 'rgba(255,255,255,0.85)';
        ctx.fillText(`${s.lastHit | 0}`, cx, H * 0.16);
        ctx.font = '17px Georgia, serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(s.lastAimed ? 'golpe dirigido' : 'toque libre', cx, H * 0.16 + 34);
        ctx.globalAlpha = 1;
      }
    }

    ctx.font = '15px Georgia, serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Mantené ESPACIO y soltá para golpear hacia el cursor  ·  R: reubicar pelota  ·  F3: debug',
      cx, H - 26);
  }

  _hints(ctx, world, W, H) {
    if (world.botsMode) return;
    const inp = world.input;
    let text = null;
    if (inp.mouseMoved < 300) text = 'Mueve el MOUSE para apuntar la escoba';
    else if (inp.thrustTime < 1.4) text = 'Mantén CLICK IZQUIERDO para acelerar';
    else if (inp.brakeTime < 0.5) text = 'CLICK DERECHO para frenar (tu cuerpo sigue de largo…)';
    else if (inp.tuckTime < 0.5) text = 'Mantén ESPACIO para recogerte y girar más rápido';
    if (!text) return;
    ctx.font = '20px Georgia, serif';
    ctx.textAlign = 'center';
    const pulse = 0.65 + 0.3 * Math.sin(this.t * 3);
    ctx.fillStyle = `rgba(255,240,200,${pulse})`;
    ctx.fillText(text, W / 2, H - 46);
  }

  // ---------- HUD MEDIEVAL ----------
  // Estandarte de piedra con dos escudos de equipo y una runa de tiempo.
  // Compacto a propósito: los protagonistas visuales son la pelota, los
  // jugadores y las físicas, no la interfaz.
  _scoreboard(ctx, world, m, cx) {
    const punch = m.scorePunch || 0;
    const golden = m.golden;
    const w = 300, h = 62, y = 10;
    const x = cx - w / 2;

    ctx.save();
    // Placa de piedra con esquinas achaflanadas (nada de rectángulos modernos)
    const cut = 14;
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x + cut, y + h);
    ctx.lineTo(x, y + h - cut);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, y, 0, y + h);
    sg.addColorStop(0, 'rgba(70,64,92,0.94)');
    sg.addColorStop(1, 'rgba(34,30,52,0.94)');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = golden ? '#ffd76a' : 'rgba(150,140,180,0.65)';
    ctx.lineWidth = golden ? 2.5 : 1.6;
    if (golden) { ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 12 + 8 * Math.sin(this.t * 4); }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Escudos de equipo: color plano, imposible confundirlos
    const crest = (px, color, score, mine) => {
      ctx.beginPath();
      ctx.moveTo(px - 26, y + 12);
      ctx.lineTo(px + 26, y + 12);
      ctx.lineTo(px + 26, y + 34);
      ctx.quadraticCurveTo(px, y + 54, px - 26, y + 34);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const s = 1 + (mine ? punch * 0.5 : 0);
      ctx.save();
      ctx.translate(px, y + 28);
      ctx.scale(s, s);
      ctx.font = 'bold 27px Georgia, serif';
      ctx.fillStyle = '#12101f';
      ctx.fillText(score, 0, 0);
      ctx.restore();
    };
    crest(cx - 96, CFG.colors.p1, m.score.p1, m.goalScorer === 'p1');
    crest(cx + 96, CFG.colors.p2, m.score.p2, m.goalScorer === 'p2');

    // Runa de tiempo en el centro
    if (golden) {
      ctx.font = 'bold 15px Georgia, serif';
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('GOL DE ORO', cx, y + 26);
      ctx.font = '11px Georgia, serif';
      ctx.fillStyle = 'rgba(255,215,106,0.7)';
      ctx.fillText('el próximo gana', cx, y + 43);
    } else {
      const t = Math.max(m.timeLeft, 0);
      const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      const low = t < 20;
      ctx.font = 'bold 26px Georgia, serif';
      ctx.fillStyle = low ? '#ff8f6a' : '#e8e2ff';
      if (low) { ctx.shadowColor = '#ff8f6a'; ctx.shadowBlur = 10; }
      ctx.fillText(`${mm}:${ss.toString().padStart(2, '0')}`, cx, y + 30);
      ctx.shadowBlur = 0;
      ctx.font = '10px Georgia, serif';
      ctx.fillStyle = 'rgba(210,200,240,0.45)';
      ctx.fillText(world.botsMode ? 'AZUL · ROJO' : 'TÚ · RIVAL', cx, y + 48);
    }
    ctx.restore();
  }

  // Frasco de energía mágica: se llena con orbes, se vacía con el boost.
  _energyVial(ctx, world, W, H) {
    const pl = world.playerA;
    if (!pl) return;
    const E = CFG.boost;
    const frac = clamp(pl.energy / E.max, 0, 1);
    const pulse = pl.energyPulse || 0;
    const boosting = pl.broom.boostPower > 0.05;

    const vw = 42, vh = 122;
    const x = 30, y = H - vh - 40;

    ctx.save();
    // Frasco: cuerpo de vidrio con cuello y tapón, no una barra genérica
    ctx.beginPath();
    ctx.moveTo(x + 11, y);
    ctx.lineTo(x + vw - 11, y);
    ctx.lineTo(x + vw - 11, y + 16);
    ctx.quadraticCurveTo(x + vw, y + 26, x + vw, y + 44);
    ctx.lineTo(x + vw, y + vh - 12);
    ctx.quadraticCurveTo(x + vw, y + vh, x + vw - 12, y + vh);
    ctx.lineTo(x + 12, y + vh);
    ctx.quadraticCurveTo(x, y + vh, x, y + vh - 12);
    ctx.lineTo(x, y + 44);
    ctx.quadraticCurveTo(x, y + 26, x + 11, y + 16);
    ctx.closePath();
    ctx.fillStyle = 'rgba(18,16,34,0.8)';
    ctx.fill();

    // Líquido mágico, con superficie que ondula
    ctx.save();
    ctx.clip();
    const top = y + vh - (vh - 22) * frac;
    const glow = boosting ? 1 : 0;
    const lg = ctx.createLinearGradient(0, top, 0, y + vh);
    lg.addColorStop(0, glow ? '#fff0b0' : '#bdf0ff');
    lg.addColorStop(1, glow ? '#ff9a3c' : '#2f8fd8');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(x, y + vh);
    ctx.lineTo(x, top);
    for (let i = 0; i <= vw; i += 4) {
      ctx.lineTo(x + i, top + Math.sin(this.t * (boosting ? 12 : 3) + i * 0.22) * (2 + pulse * 3));
    }
    ctx.lineTo(x + vw, y + vh);
    ctx.closePath();
    ctx.fill();
    // burbujas
    for (let i = 0; i < 4; i++) {
      const bt = (this.t * (boosting ? 1.6 : 0.5) + i * 0.31) % 1;
      const by = y + vh - bt * (vh - 22) * frac;
      if (by < top) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(x + 10 + ((i * 11) % (vw - 20)), by, 1.8 + (i % 2), 0, 7);
      ctx.fill();
    }
    ctx.restore();

    // Vidrio y aros de hierro
    ctx.strokeStyle = pulse > 0.05 ? '#ffd76a' : 'rgba(180,175,215,0.8)';
    ctx.lineWidth = 2 + pulse * 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,110,150,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 1, y + 40); ctx.lineTo(x + vw + 1, y + 40);
    ctx.stroke();
    // tapón
    ctx.fillStyle = '#6b5637';
    ctx.fillRect(x + 12, y - 8, vw - 24, 9);

    // Etiqueta y disponibilidad del golpe (habilidad especial)
    ctx.textAlign = 'center';
    ctx.font = '11px Georgia, serif';
    ctx.fillStyle = boosting ? '#ffd76a' : 'rgba(210,200,240,0.55)';
    ctx.fillText('MAÍZ ARCANO'.replace('MAÍZ ARCANO', 'ENERGÍA'), x + vw / 2, y + vh + 16);

    // Runa de habilidad: brilla cuando el golpe está disponible
    const ready = pl.rider.cooldownT <= 0 && pl.rider.phase !== 'whip';
    const ax = x + vw / 2, ay = y - 34;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const px = ax + Math.cos(a) * 15, py = ay + Math.sin(a) * 15;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = ready ? 'rgba(255,215,106,0.22)' : 'rgba(30,28,50,0.75)';
    ctx.fill();
    ctx.strokeStyle = ready ? '#ffd76a' : 'rgba(140,132,175,0.6)';
    ctx.lineWidth = 2;
    if (ready) {
      ctx.shadowColor = '#ffd76a';
      ctx.shadowBlur = 6 + 5 * Math.sin(this.t * 3.5);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 13px Georgia, serif';
    ctx.fillStyle = ready ? '#ffd76a' : 'rgba(150,142,185,0.7)';
    ctx.fillText('⚡'.replace('⚡', 'S'), ax, ay + 1);
    ctx.restore();
  }

  _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- DEBUG ----------
  _debug(ctx, world) {
    // Límites físicos sobre la imagen: sirve para verificar que el campo
    // jugable coincide con el patio pintado.
    const { L, R, T, B, portalY, portalR } = CFG.arena;
    ctx.strokeStyle = 'rgba(0,255,200,0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(L, T, R - L, B - T);
    ctx.strokeStyle = 'rgba(255,80,140,0.9)';
    ctx.lineWidth = 5;
    for (const x of [L, R]) {
      ctx.beginPath();
      ctx.moveTo(x, portalY - portalR);
      ctx.lineTo(x, portalY + portalR);
      ctx.stroke();
    }

    for (const player of [world.playerA, world.playerB].filter(Boolean)) {
      const r = player.rider;
      const b0 = player.broom;

      // Alcance real: círculo de la escoba vs círculo de los pies. El latigazo
      // funciona solo si el pie sale del círculo amarillo.
      ctx.strokeStyle = 'rgba(255,225,77,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b0.pos.x, b0.pos.y, CFG.broom.halfLen + CFG.ball.r + 7, 0, 7);
      ctx.stroke();
      const footR = Math.hypot(r.points.footF.x - b0.pos.x, r.points.footF.y - b0.pos.y) + CFG.ball.r + 7;
      ctx.strokeStyle = 'rgba(255,90,60,0.75)';
      ctx.beginPath();
      ctx.arc(b0.pos.x, b0.pos.y, footR, 0, 7);
      ctx.stroke();

      // Estado del latigazo
      ctx.fillStyle = '#fff';
      ctx.font = '15px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${r.phase}  swing ${r.swing.toFixed(2)}  pie ${footR.toFixed(0)}`,
        b0.pos.x + 90, b0.pos.y - 80);

      // constraints
      ctx.strokeStyle = 'rgba(0,255,140,0.7)';
      ctx.lineWidth = 1;
      for (const c of r.constraints) {
        ctx.beginPath();
        ctx.moveTo(r.points[c.a].x, r.points[c.a].y);
        ctx.lineTo(r.points[c.b].x, r.points[c.b].y);
        ctx.stroke();
      }
      // puntos
      for (const n of Object.keys(r.points)) {
        const p = r.points[n];
        ctx.fillStyle = n.startsWith('hand') ? '#ff4d6a' : '#00ff8c';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r || 4, 0, 7); ctx.fill();
      }
      // velocidad de la escoba
      const b = player.broom;
      ctx.strokeStyle = '#ffe14d';
      ctx.beginPath();
      ctx.moveTo(b.pos.x, b.pos.y);
      ctx.lineTo(b.pos.x + b.vel.x * 0.25, b.pos.y + b.vel.y * 0.25);
      ctx.stroke();
      // ángulo objetivo
      const ta = Math.atan2(player.control.aim.y - b.pos.y, player.control.aim.x - b.pos.x);
      ctx.strokeStyle = 'rgba(120,160,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(b.pos.x, b.pos.y);
      ctx.lineTo(b.pos.x + Math.cos(ta) * 90, b.pos.y + Math.sin(ta) * 90);
      ctx.stroke();
    }
    // velocidad de la pelota
    ctx.strokeStyle = '#ff9c4d';
    ctx.beginPath();
    ctx.moveTo(world.ball.pos.x, world.ball.pos.y);
    ctx.lineTo(world.ball.pos.x + world.ball.vel.x * 0.25, world.ball.pos.y + world.ball.vel.y * 0.25);
    ctx.stroke();
  }
}
