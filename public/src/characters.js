// Personajes vectoriales del juego. Cada héroe dibuja su propio cuerpo y su
// propia escoba SOBRE LOS MISMOS 9 PUNTOS del ragdoll: la física no sabe qué
// personaje la viste, así que cambiar de héroe nunca cambia cómo se juega.
//
// Regla de color: cada personaje tiene su paleta de identidad (es lo que lo
// hace reconocible), y el color del EQUIPO aparece como acento fuerte en un
// lugar fijo (tabardo, ojos, faja, bufanda). Silueta = quién es; acento = de
// qué lado juega. Sin esto, con 4 paletas distintas los bandos se confunden.
//
// Interfaz: draw(ctx, r, player, color, dark, world, fx)
//   r  = el Renderer (presta _limb, _limbSeg, _shade, _ink, t)
//   fx = { facing: +1/-1, look: {x,y} rumbo, slam: 0..1 aturdimiento }
import { CFG } from './config.js';
import { lerp, clamp } from './utils.js';

const S = CFG.charScale;
const TAU = Math.PI * 2;

// ── Ayudantes compartidos ─────────────────────────────────────────────────
function axis(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len, len };
}

// Ojos compartidos: iris corrido hacia el rumbo, cruces al estar aturdido.
// `o` ajusta color de iris (por ojo, para heterocromía) y pestañas (Valka).
function eyes(ctx, r, head, ux, uy, fx, o = {}) {
  const R = (o.R ?? 11) * S;
  const px = -uy, py = ux;
  const fxx = px * fx.facing, fyy = py * fx.facing;
  const base = { x: head.x + fxx * R * 0.34 + ux * R * 0.12,
                 y: head.y + fyy * R * 0.34 + uy * R * 0.12 };
  const sep = R * 0.30;
  const es = [
    { x: base.x + ux * sep * 0.55 + fxx * sep * 0.28,
      y: base.y + uy * sep * 0.55 + fyy * sep * 0.28, iris: o.irisA ?? '#241d33' },
    { x: base.x - ux * sep * 0.55 + fxx * sep * 0.28,
      y: base.y - uy * sep * 0.55 + fyy * sep * 0.28, iris: o.irisB ?? o.irisA ?? '#241d33' },
  ];
  if (fx.slam > 0.05) {
    ctx.strokeStyle = '#2a2136';
    ctx.lineWidth = 1.5 * S;
    for (const e of es) {
      const s2 = R * 0.2;
      ctx.beginPath();
      ctx.moveTo(e.x - s2, e.y - s2); ctx.lineTo(e.x + s2, e.y + s2);
      ctx.moveTo(e.x + s2, e.y - s2); ctx.lineTo(e.x - s2, e.y + s2);
      ctx.stroke();
    }
    return es;
  }
  let lx = 0, ly = 0;
  if (fx.look) {
    const ll = Math.hypot(fx.look.x, fx.look.y) || 1;
    lx = (fx.look.x / ll) * R * 0.12;
    ly = (fx.look.y / ll) * R * 0.12;
  }
  ctx.fillStyle = '#fbf7ef';
  for (const e of es) { ctx.beginPath(); ctx.arc(e.x, e.y, R * 0.20, 0, TAU); ctx.fill(); }
  for (const e of es) {
    ctx.fillStyle = e.iris;
    ctx.beginPath(); ctx.arc(e.x + lx, e.y + ly, R * 0.105, 0, TAU); ctx.fill();
  }
  // Pestañas: un par de trazos en la esquina exterior. Dos líneas que cambian
  // una cara por completo — es EL detalle femenino barato y legible.
  if (o.lashes) {
    ctx.strokeStyle = '#241d33';
    ctx.lineWidth = 1.1 * S;
    ctx.lineCap = 'round';
    for (const e of es) {
      ctx.beginPath();
      ctx.moveTo(e.x + fxx * R * 0.20, e.y + fyy * R * 0.20 + uy * R * 0.06);
      ctx.lineTo(e.x + fxx * R * 0.38, e.y + fyy * R * 0.38 + uy * R * 0.16);
      ctx.stroke();
    }
  }
  return es;
}

// Escoba base parametrizable: palo (recto o curvado) + anillos + punta +
// ramas por callback. Cada héroe define solo lo que lo distingue.
function broomBase(ctx, r, b, o) {
  const tip = b.tip(), tail = b.tail(), d = b.dir();
  const nx = -d.y, ny = d.x;
  const w = (o.w ?? 7) * S;
  const bx0 = tail.x + d.x * 14 * S, by0 = tail.y + d.y * 14 * S;
  const shaft = () => {
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    if (o.bend) {
      ctx.quadraticCurveTo(
        (bx0 + tip.x) / 2 + nx * o.bend * S, (by0 + tip.y) / 2 + ny * o.bend * S,
        tip.x, tip.y);
    } else ctx.lineTo(tip.x, tip.y);
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = r._ink;
  ctx.lineWidth = w + 3 * S;
  shaft(); ctx.stroke();
  const g = ctx.createLinearGradient(bx0, by0, tip.x, tip.y);
  g.addColorStop(0, o.woodDark);
  g.addColorStop(0.5, o.wood);
  g.addColorStop(1, o.woodLight ?? r._shade(o.wood, 24));
  ctx.strokeStyle = g;
  ctx.lineWidth = w;
  shaft(); ctx.stroke();
  if (o.rings) {
    ctx.strokeStyle = o.rings;
    ctx.lineWidth = w + 2 * S;
    for (const f of o.ringAt ?? [0.3, 0.56]) {
      const x = lerp(bx0, tip.x, f), y = lerp(by0, tip.y, f);
      ctx.beginPath();
      ctx.moveTo(x - d.x * 0.9 * S, y - d.y * 0.9 * S);
      ctx.lineTo(x + d.x * 0.9 * S, y + d.y * 0.9 * S);
      ctx.stroke();
    }
  }
  // Atadura de la cola
  const bxr = tail.x + d.x * 16 * S, byr = tail.y + d.y * 16 * S;
  ctx.strokeStyle = o.bind ?? '#5a3f22';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(bxr - d.x * 3 * S, byr - d.y * 3 * S);
  ctx.lineTo(bxr + d.x * 3 * S, byr + d.y * 3 * S);
  ctx.stroke();
  o.bristles?.(ctx, bxr, byr, d, nx, ny);
  o.tip?.(ctx, tip, d, nx, ny);
}

// Puños genéricos sobre los agarres (con contorno y reflejo)
function fists(ctx, r, p, skin = CFG.colors.skin) {
  for (const [h, rad] of [[p.handF, 5.8], [p.handB, 5.2]]) {
    ctx.fillStyle = r._ink;
    ctx.beginPath(); ctx.arc(h.x, h.y, rad * S + 1.4 * S, 0, TAU); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(h.x, h.y, rad * S, 0, TAU); ctx.fill();
    ctx.fillStyle = r._shade(skin, 26);
    ctx.beginPath(); ctx.arc(h.x - 1.4 * S, h.y - 1.6 * S, rad * 0.42 * S, 0, TAU); ctx.fill();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// VALKA — La Escudera (guerrera)
// Silueta: yelmo alado + trenza que flamea + escudo redondo a la espalda.
// El equipo vive en el tabardo, la cinta de la trenza y el emblema del escudo.
// ══════════════════════════════════════════════════════════════════════════
const VALKA = {
  id: 'valka', nombre: 'Valka', titulo: 'la Escudera', rol: 'Guerrera',
  bio: 'Escudera del valle del trueno. Vuela como quien carga: de frente y ' +
       'gritando. Su trenza ha tumbado más rivales que su escudo.',
  // Paletas de identidad. La alternativa se desbloquea con el desafío
  // "La Muralla" y se elige en la galería (player.paletteId).
  palettes: {
    base:     { STEEL: '#b9c2cf', STEEL_D: '#6b7686', LEATHER: '#5a4030', HAIR: '#c96f2f' },
    nocturna: { STEEL: '#5f6b80', STEEL_D: '#39414f', LEATHER: '#2f2a3a', HAIR: '#e8e2d0' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { STEEL, STEEL_D, LEATHER, HAIR } =
      this.palettes[player.paletteId] ?? this.palettes.base;

    // Trenza (usa la cadena física de la capa): cuerda que se afina, con
    // ataduras cruzadas y cinta del equipo en la punta. Flamea gratis porque
    // la mueve el mismo verlet que movía la capa del mago.
    ctx.lineCap = 'round';
    for (let i = 1; i < cape.length; i++) {
      const w0 = (9 - i * 1.1) * S;
      ctx.strokeStyle = r._ink;
      ctx.lineWidth = w0 + 2.6 * S;
      ctx.beginPath();
      ctx.moveTo(cape[i - 1].x, cape[i - 1].y);
      ctx.lineTo(cape[i].x, cape[i].y);
      ctx.stroke();
    }
    for (let i = 1; i < cape.length; i++) {
      const w0 = (9 - i * 1.1) * S;
      ctx.strokeStyle = i % 2 ? HAIR : r._shade(HAIR, -22);
      ctx.lineWidth = w0;
      ctx.beginPath();
      ctx.moveTo(cape[i - 1].x, cape[i - 1].y);
      ctx.lineTo(cape[i].x, cape[i].y);
      ctx.stroke();
    }
    const tipC = cape[cape.length - 1];
    ctx.fillStyle = color;   // cinta del equipo
    ctx.beginPath();
    ctx.arc(tipC.x, tipC.y, 3.4 * S, 0, TAU);
    ctx.fill();

    // Escudo redondo a la espalda (detrás de todo el cuerpo)
    const tA = axis(p.pelvis, p.chest);
    const backX = -tA.px * fx.facing, backY = -tA.py * fx.facing;
    const shX = p.chest.x + backX * 15 * S - tA.ux * 3 * S;
    const shY = p.chest.y + backY * 15 * S - tA.uy * 3 * S;
    ctx.fillStyle = r._ink;
    ctx.beginPath(); ctx.arc(shX, shY, 17.5 * S, 0, TAU); ctx.fill();
    const gs = ctx.createRadialGradient(shX - 4 * S, shY - 5 * S, 2 * S, shX, shY, 16 * S);
    gs.addColorStop(0, r._shade(STEEL, 28));
    gs.addColorStop(1, STEEL_D);
    ctx.fillStyle = gs;
    ctx.beginPath(); ctx.arc(shX, shY, 16 * S, 0, TAU); ctx.fill();
    ctx.strokeStyle = r._shade(STEEL_D, -24);
    ctx.lineWidth = 2.4 * S;
    ctx.beginPath(); ctx.arc(shX, shY, 12.5 * S, 0, TAU); ctx.stroke();
    // emblema del equipo + remaches
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(shX + 5 * S, shY); ctx.lineTo(shX, shY + 5 * S);
    ctx.lineTo(shX - 5 * S, shY); ctx.lineTo(shX, shY - 5 * S);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8e2d0';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(shX + Math.cos(a) * 12.5 * S, shY + Math.sin(a) * 12.5 * S, 1.4 * S, 0, TAU);
      ctx.fill();
    }

    // Miembros traseros (cuero oscuro)
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 9.5 * S, r._shade(LEATHER, -18));
    r._limbSeg(ctx, p.chest, p.handB, 8.5 * S, r._shade(LEATHER, -12));

    // Escoba-lanza: madera oscura, anillos de hierro, punta de lanza con
    // borla roja, cola atada corta (una guerrera no decora, asegura).
    broomBase(ctx, r, b, {
      wood: '#6b4a2b', woodDark: '#452e18', rings: '#8d99a6', w: 7.5,
      bristles: (c, x, y) => {
        c.strokeStyle = '#8a6a3a';
        c.lineWidth = 2.6 * S;
        for (let i = -2; i <= 2; i++) {
          const a = b.angle + Math.PI + i * 0.09;
          const len = (22 - Math.abs(i) * 2) * S;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          c.stroke();
        }
      },
      tip: (c, tip, d, nx, ny) => {
        // hoja de lanza
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(tip.x + d.x * 13 * S, tip.y + d.y * 13 * S);
        c.lineTo(tip.x + nx * 4.6 * S, tip.y + ny * 4.6 * S);
        c.lineTo(tip.x - nx * 4.6 * S, tip.y - ny * 4.6 * S);
        c.closePath(); c.fill();
        c.fillStyle = STEEL;
        c.beginPath();
        c.moveTo(tip.x + d.x * 11.5 * S, tip.y + d.y * 11.5 * S);
        c.lineTo(tip.x + nx * 3.4 * S, tip.y + ny * 3.4 * S);
        c.lineTo(tip.x - nx * 3.4 * S, tip.y - ny * 3.4 * S);
        c.closePath(); c.fill();
        // borla
        c.strokeStyle = '#b03a30';
        c.lineWidth = 1.6 * S;
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.moveTo(tip.x, tip.y);
          c.lineTo(tip.x - d.x * 7 * S + nx * i * 3 * S + Math.sin(r.t * 8 + i) * S,
                   tip.y - d.y * 7 * S + ny * i * 3 * S);
          c.stroke();
        }
      },
    });

    // Pierna delantera + greba de acero sobre la pantorrilla
    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 10.5 * S, LEATHER);
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 7 * S;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lerp(p.kneeF.x, p.footF.x, 0.15), lerp(p.kneeF.y, p.footF.y, 0.15));
    ctx.lineTo(lerp(p.kneeF.x, p.footF.x, 0.72), lerp(p.kneeF.y, p.footF.y, 0.72));
    ctx.stroke();

    // Coraza: torso más entallado que el del mago (cintura marcada), acero
    // con degradado, dos costillas de placa, tabardo del equipo colgando del
    // cinturón y hombrera redonda del lado del frente.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 11 * S, HW_H = 12.5 * S, HW_W = 8.5 * S; // pecho/cadera/cintura
      const at = (f, side, hw) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * hw * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * hw * side,
      });
      const path = () => {
        const c1 = at(1, 1, HW_C), c2 = at(1, -1, HW_C);
        const w1 = at(0.42, -1, HW_W), h1 = at(0, -1, HW_H);
        const h2 = at(0, 1, HW_H), w2 = at(0.42, 1, HW_W);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
        ctx.quadraticCurveTo(w1.x, w1.y, h1.x, h1.y);
        ctx.lineTo(h2.x, h2.y);
        ctx.quadraticCurveTo(w2.x, w2.y, c1.x, c1.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.2 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(STEEL, 22));
      g.addColorStop(0.55, STEEL);
      g.addColorStop(1, STEEL_D);
      path(); ctx.fillStyle = g; ctx.fill();
      // costillas de la placa
      ctx.strokeStyle = STEEL_D;
      ctx.globalAlpha = 0.6; ctx.lineWidth = 1.4 * S;
      for (const f of [0.62, 0.8]) {
        const l1 = at(f, 0.8, HW_C), l2 = at(f, -0.8, HW_C);
        ctx.beginPath(); ctx.moveTo(l1.x, l1.y);
        ctx.quadraticCurveTo(
          lerp(p.pelvis.x, p.chest.x, f - 0.08), lerp(p.pelvis.y, p.chest.y, f - 0.08),
          l2.x, l2.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // tabardo del equipo (faldón que cae del cinturón)
      const b1 = at(0.34, 0.75, HW_W + 2 * S), b2 = at(0.34, -0.75, HW_W + 2 * S);
      const low = { x: p.pelvis.x - A.ux * 12 * S, y: p.pelvis.y - A.uy * 12 * S };
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y);
      ctx.lineTo(low.x - A.px * 7 * S, low.y - A.py * 7 * S);
      ctx.lineTo(low.x + A.px * 7 * S, low.y + A.py * 7 * S);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2 * S; ctx.stroke();
      // franja clara del tabardo
      ctx.strokeStyle = r._shade(color, 55);
      ctx.lineWidth = 1.6 * S;
      ctx.beginPath();
      ctx.moveTo(lerp(b1.x, b2.x, 0.5), lerp(b1.y, b2.y, 0.5));
      ctx.lineTo(low.x, low.y);
      ctx.stroke();
      // cinturón + hebilla redonda
      const bl1 = at(0.36, 1, HW_W + 2.5 * S), bl2 = at(0.36, -1, HW_W + 2.5 * S);
      ctx.strokeStyle = r._ink; ctx.lineWidth = 6 * S;
      ctx.beginPath(); ctx.moveTo(bl1.x, bl1.y); ctx.lineTo(bl2.x, bl2.y); ctx.stroke();
      ctx.strokeStyle = '#3f2f20'; ctx.lineWidth = 4.4 * S;
      ctx.beginPath(); ctx.moveTo(bl1.x, bl1.y); ctx.lineTo(bl2.x, bl2.y); ctx.stroke();
      const bc = at(0.36, 0, 0);
      ctx.fillStyle = '#e8c25a';
      ctx.beginPath(); ctx.arc(bc.x, bc.y, 3.4 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8a6c22';
      ctx.beginPath(); ctx.arc(bc.x, bc.y, 1.5 * S, 0, TAU); ctx.fill();
      // hombrera del frente: dos arcos apilados sobre el hombro
      const sf = at(0.97, 0, 0);
      const shoX = sf.x + A.px * fx.facing * 9 * S, shoY = sf.y + A.py * fx.facing * 9 * S;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(shoX, shoY, 8.6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = r._shade(STEEL, 12);
      ctx.beginPath(); ctx.arc(shoX, shoY, 7.2 * S, 0, TAU); ctx.fill();
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = 1.6 * S;
      ctx.beginPath(); ctx.arc(shoX, shoY, 4.6 * S, 0, TAU); ctx.stroke();
    }

    // Brazo delantero + brazalete
    r._limbSeg(ctx, p.chest, p.handF, 9 * S, LEATHER);
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 6.5 * S;
    ctx.beginPath();
    ctx.moveTo(lerp(p.chest.x, p.handF.x, 0.55), lerp(p.chest.y, p.handF.y, 0.55));
    ctx.lineTo(lerp(p.chest.x, p.handF.x, 0.86), lerp(p.chest.y, p.handF.y, 0.86));
    ctx.stroke();

    // Guanteletes de acero
    fists(ctx, r, p, STEEL);

    // Cabeza: cara femenina (mentón más fino), pintura de guerra del equipo,
    // pestañas, mechones de la trenza asomando y yelmo alado con nasal.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 10.5 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      // contorno + cara (levemente elíptica: mentón fino)
      ctx.fillStyle = r._ink;
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(Math.atan2(A.uy, A.ux));
      ctx.beginPath(); ctx.ellipse(0, 0, (R + 1.5 * S) * 1.02, R + 1.5 * S, 0, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(R, 0, -R, 0);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 20));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -24));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 0.98, R, 0, 0, TAU); ctx.fill();
      ctx.restore();
      // mechones de pelo bajo el casco
      ctx.strokeStyle = HAIR;
      ctx.lineWidth = 2.6 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(head.x - fxx * R * 0.7 + A.ux * R * 0.5, head.y - fyy * R * 0.7 + A.uy * R * 0.5);
      ctx.lineTo(head.x - fxx * R * 0.95 - A.ux * R * 0.35, head.y - fyy * R * 0.95 - A.uy * R * 0.35);
      ctx.stroke();
      // pintura de guerra: dos rayas del equipo en el pómulo
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.7 * S;
      for (const o2 of [0, 0.24]) {
        ctx.beginPath();
        ctx.moveTo(head.x + fxx * R * (0.45 + o2) - A.ux * R * 0.05,
                   head.y + fyy * R * (0.45 + o2) - A.uy * R * 0.05);
        ctx.lineTo(head.x + fxx * R * (0.62 + o2) - A.ux * R * 0.42,
                   head.y + fyy * R * (0.62 + o2) - A.uy * R * 0.42);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 10.5, lashes: true });
      // boca: media sonrisa segura
      ctx.strokeStyle = '#a15a4a';
      ctx.lineWidth = 1.4 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.42 - A.ux * R * 0.34,
              head.y + fyy * R * 0.42 - A.uy * R * 0.34, R * 0.2,
              Math.atan2(fyy, fxx) - 0.5, Math.atan2(fyy, fxx) + 0.7);
      ctx.stroke();
      // yelmo: casquete + nasal + alas
      const domeA = Math.atan2(A.py, A.px);
      ctx.fillStyle = r._ink;
      ctx.beginPath();
      ctx.ellipse(head.x + A.ux * R * 0.55, head.y + A.uy * R * 0.55,
                  R * 1.12, R * 0.78, domeA, Math.PI, TAU);
      ctx.fill();
      const gh = ctx.createLinearGradient(
        head.x + A.px * R, head.y + A.py * R,
        head.x - A.px * R, head.y - A.py * R);
      gh.addColorStop(0, r._shade(STEEL, 26));
      gh.addColorStop(1, STEEL_D);
      ctx.fillStyle = gh;
      ctx.beginPath();
      ctx.ellipse(head.x + A.ux * R * 0.55, head.y + A.uy * R * 0.55,
                  R * 1.02, R * 0.68, domeA, Math.PI, TAU);
      ctx.fill();
      // nasal
      ctx.strokeStyle = STEEL_D;
      ctx.lineWidth = 2.2 * S;
      ctx.beginPath();
      ctx.moveTo(head.x + fxx * R * 0.62 + A.ux * R * 0.5,
                 head.y + fyy * R * 0.62 + A.uy * R * 0.5);
      ctx.lineTo(head.x + fxx * R * 0.68 + A.ux * R * 0.05,
                 head.y + fyy * R * 0.68 + A.uy * R * 0.05);
      ctx.stroke();
      // alas del yelmo (la del frente grande, la de atrás asoma)
      const wing = (side, sc) => {
        const wx = head.x + A.px * side * R * 0.95 + A.ux * R * 0.62;
        const wy = head.y + A.py * side * R * 0.95 + A.uy * R * 0.62;
        ctx.fillStyle = r._ink;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + A.px * side * 7 * S * sc + A.ux * 10 * S * sc,
                   wy + A.py * side * 7 * S * sc + A.uy * 10 * S * sc);
        ctx.lineTo(wx + A.px * side * 2 * S * sc + A.ux * 4 * S * sc,
                   wy + A.py * side * 2 * S * sc + A.uy * 4 * S * sc);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8e2d0';
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + A.px * side * 5.6 * S * sc + A.ux * 8.4 * S * sc,
                   wy + A.py * side * 5.6 * S * sc + A.uy * 8.4 * S * sc);
        ctx.lineTo(wx + A.px * side * 1.6 * S * sc + A.ux * 3.4 * S * sc,
                   wy + A.py * side * 1.6 * S * sc + A.uy * 3.4 * S * sc);
        ctx.closePath(); ctx.fill();
      };
      wing(-fx.facing, 0.8);
      wing(fx.facing, 1.1);
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// MORDRAK — El Brujo del Pantano
// Silueta: capucha profunda sin cara (solo ojos brillantes), túnica harapienta
// de dobladillo dentado, báculo torcido con calavera. El equipo vive en el
// BRILLO: ojos, runas y frascos relucen del color del bando.
// ══════════════════════════════════════════════════════════════════════════
const MORDRAK = {
  id: 'mordrak', nombre: 'Mordrak', titulo: 'el Brujo del Pantano', rol: 'Brujo',
  bio: 'Nadie sabe qué guarda en los frascos y nadie quiere averiguarlo. Su ' +
       'escoba no fue tallada: una noche sin luna se talló sola.',
  // "Espectro": túnica pálida y amuletos oscuros — el negativo del brujo.
  // Se desbloquea con el desafío "Imparable".
  palettes: {
    base:     { ROBE: '#3b2b52', ROBE_D: '#241a38', BONE: '#cfc4a4' },
    espectro: { ROBE: '#8f8ca0', ROBE_D: '#5f5c72', BONE: '#2a2136' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { ROBE, ROBE_D, BONE } =
      this.palettes[player.paletteId] ?? this.palettes.base;
    const glow = color;   // el acento de equipo es el brillo

    // Capa harapienta: mismo verlet, pero el borde inferior alterna ancho
    // completo y medio ancho — dobladillo dentado, tela podrida.
    const capePath = () => {
      ctx.beginPath();
      ctx.moveTo(cape[0].x, cape[0].y);
      for (let i = 1; i < cape.length; i++) {
        const w = (13 - i * 1.4) * S * (i % 2 ? 1 : 0.45);
        ctx.lineTo(cape[i].x, cape[i].y + w);
      }
      for (let i = cape.length - 1; i >= 0; i--) {
        const w = (13 - i * 1.4) * S * (i % 2 ? 0.5 : 1);
        ctx.lineTo(cape[i].x, cape[i].y - w);
      }
      ctx.closePath();
    };
    capePath();
    ctx.strokeStyle = r._ink; ctx.lineWidth = 2.6 * S; ctx.lineJoin = 'round'; ctx.stroke();
    const gc = ctx.createLinearGradient(cape[0].x, cape[0].y,
      cape[cape.length - 1].x, cape[cape.length - 1].y);
    gc.addColorStop(0, ROBE);
    gc.addColorStop(1, r._shade(ROBE_D, -14));
    capePath();
    ctx.fillStyle = gc; ctx.globalAlpha = 0.96; ctx.fill(); ctx.globalAlpha = 1;

    // Miembros: esqueléticos (más finos que cualquier otro héroe)
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 6.5 * S, r._shade(ROBE_D, -8));
    r._limbSeg(ctx, p.chest, p.handB, 6 * S, ROBE_D);

    // Báculo torcido: curva, sin anillos, calavera de cuervo en la punta con
    // ojo brillante del equipo, y ramas raídas con un amuleto colgando.
    broomBase(ctx, r, b, {
      wood: '#4a4034', woodDark: '#2e2820', woodLight: '#5f5442', w: 6, bend: 9,
      bind: '#3a3028',
      bristles: (c, x, y, d, nx, ny) => {
        c.strokeStyle = '#4f4636';
        c.lineWidth = 2 * S;
        for (let i = -2; i <= 2; i++) {
          const wob = 1 + Math.sin(i * 3.1) * 0.35;
          const a = b.angle + Math.PI + i * 0.17 + Math.sin(r.t * 2 + i * 2) * 0.04;
          const len = (34 - Math.abs(i) * 3) * wob * S;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          c.stroke();
        }
        // amuleto: un huesito colgando que se hamaca
        const sw = Math.sin(r.t * 3.2) * 0.5;
        const ax2 = x - d.x * 6 * S + nx * (10 * S + sw * 4 * S);
        const ay2 = y - d.y * 6 * S + ny * (10 * S + sw * 4 * S);
        c.strokeStyle = '#8a8070';
        c.lineWidth = 1 * S;
        c.beginPath(); c.moveTo(x - d.x * 6 * S, y - d.y * 6 * S); c.lineTo(ax2, ay2); c.stroke();
        c.fillStyle = BONE;
        c.beginPath(); c.arc(ax2, ay2, 2 * S, 0, TAU); c.fill();
        c.beginPath(); c.arc(ax2 + nx * 3 * S, ay2 + ny * 3 * S, 2 * S, 0, TAU); c.fill();
      },
      tip: (c, tip, d, nx, ny) => {
        // calavera de cuervo: cráneo + pico
        c.fillStyle = r._ink;
        c.beginPath(); c.arc(tip.x, tip.y, 5.6 * S, 0, TAU); c.fill();
        c.fillStyle = BONE;
        c.beginPath(); c.arc(tip.x, tip.y, 4.4 * S, 0, TAU); c.fill();
        c.beginPath();
        c.moveTo(tip.x + d.x * 3 * S + nx * 2 * S, tip.y + d.y * 3 * S + ny * 2 * S);
        c.lineTo(tip.x + d.x * 10 * S, tip.y + d.y * 10 * S);
        c.lineTo(tip.x + d.x * 3 * S - nx * 1.4 * S, tip.y + d.y * 3 * S - ny * 1.4 * S);
        c.closePath(); c.fill();
        // ojo brillante del equipo
        const pulse = 0.6 + 0.4 * Math.sin(r.t * 5);
        c.fillStyle = glow;
        c.shadowColor = glow;
        c.shadowBlur = 8 * pulse;
        c.beginPath();
        c.arc(tip.x + d.x * 1.2 * S - d.y * 1.2 * S,
              tip.y + d.y * 1.2 * S + d.x * 1.2 * S, 1.4 * S, 0, TAU);
        c.fill();
        c.shadowBlur = 0;
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 7 * S, ROBE_D);

    // Túnica: acampanada, con dobladillo dentado, cordón con frascos que
    // brillan y tres runas del equipo encendidas por el pecho.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 10 * S, HW_H = 18 * S;
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        // bajada con dobladillo dentado (5 picos)
        const h1 = at(0, -1, 2 * S), h2 = at(0, 1, 2 * S);
        ctx.lineTo(h1.x, h1.y);
        for (let i = 1; i <= 5; i++) {
          const f = i / 5;
          const bxp = lerp(h1.x, h2.x, f), byp = lerp(h1.y, h2.y, f);
          const dip = (i % 2 ? 6 : 1.5) * S;
          ctx.lineTo(bxp - A.ux * dip, byp - A.uy * dip);
        }
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(ROBE, 16));
      g.addColorStop(0.55, ROBE);
      g.addColorStop(1, r._shade(ROBE_D, -10));
      path(); ctx.fillStyle = g; ctx.fill();
      // runas del equipo, encendidas y latiendo
      const pulse = 0.55 + 0.45 * Math.sin(r.t * 3.2);
      ctx.strokeStyle = glow;
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.shadowColor = glow; ctx.shadowBlur = 7 * pulse;
      ctx.lineWidth = 1.5 * S;
      const runa = (f, kind) => {
        const cx2 = lerp(p.pelvis.x, p.chest.x, f), cy2 = lerp(p.pelvis.y, p.chest.y, f);
        ctx.beginPath();
        if (kind === 0) ctx.arc(cx2, cy2, 2.4 * S, 0, TAU);
        else if (kind === 1) {
          ctx.moveTo(cx2 - 2.4 * S, cy2 + 2 * S); ctx.lineTo(cx2, cy2 - 2.4 * S);
          ctx.lineTo(cx2 + 2.4 * S, cy2 + 2 * S); ctx.closePath();
        } else {
          ctx.moveTo(cx2 - 2.4 * S, cy2 - 2 * S); ctx.lineTo(cx2, cy2);
          ctx.lineTo(cx2 - 1 * S, cy2 + 1 * S); ctx.lineTo(cx2 + 2.4 * S, cy2 + 2.4 * S);
        }
        ctx.stroke();
      };
      runa(0.72, 0); runa(0.52, 1); runa(0.32, 2);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      // cordón + frascos colgantes con líquido brillante
      const b1 = at(0.3, 1, 1 * S), b2 = at(0.3, -1, 1 * S);
      ctx.strokeStyle = '#9a8f6e'; ctx.lineWidth = 1.8 * S;
      ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      for (const side of [0.45, -0.5]) {
        const hx = lerp(b1.x, b2.x, 0.5 + side * 0.4), hy = lerp(b1.y, b2.y, 0.5 + side * 0.4);
        const vx = hx - A.ux * 5 * S, vy = hy - A.uy * 5 * S;
        ctx.strokeStyle = '#9a8f6e'; ctx.lineWidth = 0.9 * S;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(vx, vy); ctx.stroke();
        ctx.fillStyle = r._ink;
        ctx.fillRect(vx - 2.2 * S, vy - 0.6 * S, 4.4 * S, 6 * S);
        ctx.fillStyle = glow;
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(r.t * 4 + side * 9);
        ctx.fillRect(vx - 1.4 * S, vy + 1.2 * S, 2.8 * S, 3.4 * S);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#6a5f48';
        ctx.fillRect(vx - 1.2 * S, vy - 1.6 * S, 2.4 * S, 1.6 * S);
      }
    }

    r._limbSeg(ctx, p.chest, p.handF, 6.5 * S, ROBE);

    // Garras de hueso en vez de puños: tres trazos que salen de cada mano
    for (const [h, sc] of [[p.handF, 1], [p.handB, 0.85]]) {
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, 4.6 * S * sc, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9aa08a';
      ctx.beginPath(); ctx.arc(h.x, h.y, 3.6 * S * sc, 0, TAU); ctx.fill();
      ctx.strokeStyle = BONE;
      ctx.lineWidth = 1.5 * S * sc;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x + Math.cos(b.angle + i * 0.5) * 6.5 * S * sc,
                   h.y + Math.sin(b.angle + i * 0.5) * 6.5 * S * sc);
        ctx.stroke();
      }
    }

    // Capucha profunda: la cara es sombra, solo dos ojos del equipo. Collar
    // de dientes y plumas de cuervo en el hombro.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      // hueco de la capucha: elipse casi negra
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.4 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#120d1e';
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // ojos brillantes (cruces al aturdirse los apagan)
      if (fx.slam > 0.05) {
        eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11 });
      } else {
        const pulse = 0.7 + 0.3 * Math.sin(r.t * 4.2);
        let lx = 0, ly = 0;
        if (fx.look) {
          const ll = Math.hypot(fx.look.x, fx.look.y) || 1;
          lx = (fx.look.x / ll) * R * 0.1; ly = (fx.look.y / ll) * R * 0.1;
        }
        ctx.fillStyle = glow;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 9 * pulse;
        for (const sgn of [0.55, -0.55]) {
          ctx.beginPath();
          ctx.arc(head.x + fxx * R * 0.4 + A.ux * R * sgn * 0.5 + lx,
                  head.y + fyy * R * 0.4 + A.uy * R * sgn * 0.5 + ly,
                  1.7 * S, 0, TAU);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      // capucha: cubre la cabeza y cae en punta hacia atrás
      const hood = () => {
        const bL = { x: head.x + fxx * (R + 3 * S) - A.ux * R * 0.5,
                     y: head.y + fyy * (R + 3 * S) - A.uy * R * 0.5 };
        const top = { x: head.x + A.ux * (R + 5 * S), y: head.y + A.uy * (R + 5 * S) };
        const tipH = { x: head.x - fxx * (R + 12 * S) - A.ux * R * 0.1,
                       y: head.y - fyy * (R + 12 * S) - A.uy * R * 0.1 };
        const low = { x: head.x - fxx * R * 0.7 - A.ux * R * 0.75,
                      y: head.y - fyy * R * 0.7 - A.uy * R * 0.75 };
        ctx.beginPath();
        ctx.moveTo(bL.x, bL.y);
        ctx.quadraticCurveTo(top.x + fxx * R * 0.6, top.y + fyy * R * 0.6, top.x, top.y);
        ctx.quadraticCurveTo(tipH.x + A.ux * 6 * S, tipH.y + A.uy * 6 * S, tipH.x, tipH.y);
        ctx.quadraticCurveTo(low.x, low.y, bL.x, bL.y);
        ctx.closePath();
      };
      hood();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2.8 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const gh = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gh.addColorStop(0, r._shade(ROBE, 14));
      gh.addColorStop(1, ROBE_D);
      hood(); ctx.fillStyle = gh; ctx.fill();
      // collar de dientes bajo el mentón
      ctx.fillStyle = BONE;
      for (let i = -1; i <= 1; i++) {
        const tx = head.x - A.ux * (R + 2 * S) + A.px * i * 4 * S + fxx * 2 * S;
        const ty = head.y - A.uy * (R + 2 * S) + A.py * i * 4 * S + fyy * 2 * S;
        ctx.beginPath();
        ctx.moveTo(tx - 1.4 * S, ty); ctx.lineTo(tx + 1.4 * S, ty);
        ctx.lineTo(tx, ty + 3.6 * S);
        ctx.closePath(); ctx.fill();
      }
      // plumas de cuervo en el hombro trasero
      ctx.fillStyle = '#1a1526';
      for (let i = 0; i < 3; i++) {
        const px2 = chest.x - fxx * (8 + i * 3) * S + A.ux * (4 - i) * S;
        const py2 = chest.y - fyy * (8 + i * 3) * S + A.uy * (4 - i) * S;
        ctx.beginPath();
        ctx.moveTo(px2, py2);
        ctx.lineTo(px2 - fxx * 6 * S - A.ux * 2 * S, py2 - fyy * 6 * S - A.uy * 2 * S);
        ctx.lineTo(px2 - fxx * 3 * S + A.ux * 3 * S, py2 - fyy * 3 * S + A.uy * 3 * S);
        ctx.closePath(); ctx.fill();
      }
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// ÍZAR — El Mago Elemental
// Silueta: cresta de fuego animada + diadema de cristal + dos orbes (fuego e
// hielo) orbitando el torso. Mitad cálida, mitad fría; el equipo va en la faja.
// ══════════════════════════════════════════════════════════════════════════
const IZAR = {
  id: 'izar', nombre: 'Ízar', titulo: 'el Elemental', rol: 'Mago elemental',
  bio: 'Discute consigo mismo: la mano derecha quema y la izquierda congela. ' +
       'Cuando las dos se ponen de acuerdo, mejor mirar desde lejos.',
  // "Inverso": fuego y hielo intercambiados — la cresta arde en azul y la
  // cola de la escoba es de brasas. Se desbloquea con "Piromanía".
  palettes: {
    base:    { ROBE: '#4a3f6e', FIRE: '#ff8a3c', FIRE2: '#ffd76a', ICE: '#7fd8ff', ICE2: '#e8f8ff' },
    inverso: { ROBE: '#3f4a6e', FIRE: '#7fd8ff', FIRE2: '#e8f8ff', ICE: '#ff8a3c', ICE2: '#ffd76a' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom;
    const { ROBE, FIRE, FIRE2, ICE, ICE2 } =
      this.palettes[player.paletteId] ?? this.palettes.base;

    // Orbes elementales orbitando el pecho: el de atrás se dibuja antes del
    // cuerpo y el de adelante al final — profundidad real, no truco de alpha.
    const orbPos = (phase) => {
      const a = r.t * 1.8 + phase;
      return {
        x: p.chest.x + Math.cos(a) * 24 * S,
        y: p.chest.y + Math.sin(a) * 10 * S,
        front: Math.sin(a) > 0,
      };
    };
    const orbs = [
      { ...orbPos(0), col: FIRE, col2: FIRE2 },
      { ...orbPos(Math.PI), col: ICE, col2: ICE2 },
    ];
    const drawOrb = (o) => {
      ctx.fillStyle = o.col;
      ctx.shadowColor = o.col;
      ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(o.x, o.y, 3.6 * S, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = o.col2;
      ctx.beginPath(); ctx.arc(o.x - 0.8 * S, o.y - S, 1.4 * S, 0, TAU); ctx.fill();
    };
    for (const o of orbs) if (!o.front) drawOrb(o);

    // Estela elemental (la cadena de la capa): motas alternadas de brasa y
    // escarcha que se apagan hacia la punta. No hay tela: hay temperatura.
    const cape = player.rider.cape;
    for (let i = 1; i < cape.length; i++) {
      const hot = i % 2 === 0;
      const rad = (6.5 - i * 0.8) * S;
      if (rad <= 0.5) continue;
      ctx.globalAlpha = Math.max(0.05, 0.75 - i * 0.09);
      ctx.fillStyle = hot ? FIRE : ICE;
      ctx.shadowColor = hot ? FIRE : ICE;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cape[i].x, cape[i].y + Math.sin(r.t * 6 + i) * 2 * S, rad, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 8.5 * S, r._shade(ROBE, -26));
    r._limbSeg(ctx, p.chest, p.handB, 7.5 * S, r._shade(ROBE, -18));

    // Escoba de obsidiana: punta de cristal facetado que arde con el impulso
    // y cola de carámbanos de hielo.
    broomBase(ctx, r, b, {
      wood: '#3a3450', woodDark: '#26223a', woodLight: '#575178', w: 6.5,
      bind: '#575178',
      bristles: (c, x, y, d, nx, ny) => {
        // carámbanos: triángulos rellenos, del más largo al más corto
        for (let i = -2; i <= 2; i++) {
          const a = b.angle + Math.PI + i * 0.16;
          const len = (26 - Math.abs(i) * 4) * S;
          const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
          c.fillStyle = i % 2 ? ICE : ICE2;
          c.globalAlpha = 0.9;
          c.beginPath();
          c.moveTo(x + nx * 2 * S, y + ny * 2 * S);
          c.lineTo(x - nx * 2 * S, y - ny * 2 * S);
          c.lineTo(ex, ey);
          c.closePath(); c.fill();
        }
        c.globalAlpha = 1;
      },
      tip: (c, tip, d, nx, ny) => {
        const heat = 0.3 + b.thrustPower * 0.5 + (b.boostPower || 0) * 0.6;
        // cristal facetado: dos triángulos espejados
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(tip.x - d.x * 2 * S + nx * 4.4 * S, tip.y - d.y * 2 * S + ny * 4.4 * S);
        c.lineTo(tip.x + d.x * 9 * S, tip.y + d.y * 9 * S);
        c.lineTo(tip.x - d.x * 2 * S - nx * 4.4 * S, tip.y - d.y * 2 * S - ny * 4.4 * S);
        c.lineTo(tip.x - d.x * 6 * S, tip.y - d.y * 6 * S);
        c.closePath(); c.fill();
        c.fillStyle = FIRE;
        c.shadowColor = FIRE;
        c.shadowBlur = 14 * heat;
        c.globalAlpha = Math.min(1, 0.55 + heat * 0.5);
        c.beginPath();
        c.moveTo(tip.x - d.x * 1.4 * S + nx * 3.2 * S, tip.y - d.y * 1.4 * S + ny * 3.2 * S);
        c.lineTo(tip.x + d.x * 7.4 * S, tip.y + d.y * 7.4 * S);
        c.lineTo(tip.x - d.x * 1.4 * S - nx * 3.2 * S, tip.y - d.y * 1.4 * S - ny * 3.2 * S);
        c.lineTo(tip.x - d.x * 4.6 * S, tip.y - d.y * 4.6 * S);
        c.closePath(); c.fill();
        c.shadowBlur = 0; c.globalAlpha = 1;
        c.strokeStyle = FIRE2;
        c.lineWidth = 0.9 * S;
        c.beginPath();
        c.moveTo(tip.x - d.x * 4.6 * S, tip.y - d.y * 4.6 * S);
        c.lineTo(tip.x + d.x * 7.4 * S, tip.y + d.y * 7.4 * S);
        c.stroke();
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 9 * S, r._shade(ROBE, -12));

    // Túnica mitad y mitad: base violeta con un velo térmico encima — cálido
    // hacia el frente, frío hacia atrás — más faja del equipo y glifos.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 10.5 * S, HW_H = 15.5 * S;
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1), h1 = at(0, -1, 2 * S), h2 = at(0, 1, 2 * S);
        const mid = { x: lerp(h1.x, h2.x, 0.5) - A.ux * 3 * S,
                      y: lerp(h1.y, h2.y, 0.5) - A.uy * 3 * S };
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(h1.x, h1.y);
        ctx.quadraticCurveTo(mid.x, mid.y, h2.x, h2.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.2 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const gb = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      gb.addColorStop(0, r._shade(ROBE, 22));
      gb.addColorStop(1, r._shade(ROBE, -30));
      path(); ctx.fillStyle = gb; ctx.fill();
      // velo térmico: cálido en la mitad del frente, frío en la de atrás
      const gt = ctx.createLinearGradient(
        p.chest.x + A.px * fx.facing * HW_C, p.chest.y + A.py * fx.facing * HW_C,
        p.chest.x - A.px * fx.facing * HW_C, p.chest.y - A.py * fx.facing * HW_C);
      gt.addColorStop(0, FIRE);
      gt.addColorStop(0.5, 'rgba(90,70,140,0)');
      gt.addColorStop(1, ICE);
      path();
      ctx.fillStyle = gt;
      ctx.globalAlpha = 0.30;
      ctx.fill();
      ctx.globalAlpha = 1;
      // faja del equipo, en diagonal hombro→cadera
      const s1 = at(0.92, fx.facing * 0.7), s2 = at(0.18, -fx.facing * 0.85);
      ctx.strokeStyle = r._ink; ctx.lineWidth = 6.2 * S;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 4.6 * S;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      ctx.strokeStyle = r._shade(color, 50); ctx.lineWidth = 1.2 * S;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      // glifos gemelos: llama y copo a cada lado del pecho
      const gl = (side, col, kind) => {
        const gx = lerp(p.pelvis.x, p.chest.x, 0.66) + A.px * side * 6 * S;
        const gy = lerp(p.pelvis.y, p.chest.y, 0.66) + A.py * side * 6 * S;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.2 * S;
        ctx.beginPath();
        if (kind === 'fuego') {
          ctx.moveTo(gx - 1.6 * S, gy + 2 * S);
          ctx.quadraticCurveTo(gx - 2 * S, gy - 1.5 * S, gx, gy - 2.6 * S);
          ctx.quadraticCurveTo(gx + 2 * S, gy - 1, gx + 1.6 * S, gy + 2 * S);
        } else {
          for (let i = 0; i < 3; i++) {
            const a = i * Math.PI / 3;
            ctx.moveTo(gx - Math.cos(a) * 2.6 * S, gy - Math.sin(a) * 2.6 * S);
            ctx.lineTo(gx + Math.cos(a) * 2.6 * S, gy + Math.sin(a) * 2.6 * S);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      gl(fx.facing, FIRE2, 'fuego');
      gl(-fx.facing, ICE2, 'copo');
    }

    r._limbSeg(ctx, p.chest, p.handF, 8 * S, ROBE);

    // Manos con aura: la delantera arde, la trasera escarcha
    fists(ctx, r, p);
    {
      const flick = Math.sin(r.t * 11);
      ctx.fillStyle = FIRE;
      ctx.globalAlpha = 0.5 + 0.25 * flick;
      ctx.shadowColor = FIRE; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.handF.x + flick * S, p.handF.y - 6 * S - Math.abs(flick) * 2 * S, 2.6 * S, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = ICE2;
      ctx.lineWidth = 1.1 * S;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i - 1) * 0.7 + Math.sin(r.t * 3) * 0.1;
        ctx.beginPath();
        ctx.moveTo(p.handB.x, p.handB.y);
        ctx.lineTo(p.handB.x + Math.cos(a) * 6.5 * S, p.handB.y + Math.sin(a) * 6.5 * S);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Cabeza: cráneo con tatuajes rúnicos, diadema de cristales y CRESTA DE
    // FUEGO animada. Heterocromía: un ojo de fuego, otro de hielo.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.5 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 14));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -26));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // tatuajes rúnicos: dos arcos finos sobre la sien trasera
      ctx.strokeStyle = r._shade(ROBE, 30);
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1 * S;
      for (const o2 of [0.35, 0.55]) {
        ctx.beginPath();
        ctx.arc(head.x - fxx * R * o2, head.y - fyy * R * o2, R * 0.5,
                Math.atan2(A.uy, A.ux) - 0.9, Math.atan2(A.uy, A.ux) + 0.9);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // heterocromía
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11, irisA: '#ff7a2c', irisB: '#3fb9e6' });
      // perilla corta
      ctx.fillStyle = '#3a2f4a';
      ctx.beginPath();
      ctx.arc(head.x - A.ux * R * 0.95 + fxx * R * 0.28,
              head.y - A.uy * R * 0.95 + fyy * R * 0.28, R * 0.24, 0, TAU);
      ctx.fill();
      // diadema de cristales sobre la frente
      for (let i = -1; i <= 1; i++) {
        const dx2 = head.x + A.ux * R * 0.72 + A.px * i * 5 * S;
        const dy2 = head.y + A.uy * R * 0.72 + A.py * i * 5 * S;
        const h2 = (i === 0 ? 4.6 : 3.2) * S;
        ctx.fillStyle = r._ink;
        ctx.beginPath();
        ctx.moveTo(dx2 - 1.8 * S, dy2); ctx.lineTo(dx2, dy2 - h2);
        ctx.lineTo(dx2 + 1.8 * S, dy2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = i === 0 ? color : ICE;   // el central marca el equipo
        ctx.beginPath();
        ctx.moveTo(dx2 - 1.2 * S, dy2 - 0.6 * S); ctx.lineTo(dx2, dy2 - h2 + 0.8 * S);
        ctx.lineTo(dx2 + 1.2 * S, dy2 - 0.6 * S); ctx.closePath(); ctx.fill();
      }
      // cresta de fuego: lenguas que flamean con el tiempo y crecen al acelerar
      const heat = 1 + b.thrustPower * 0.6 + (b.boostPower || 0) * 0.8;
      for (let i = -1; i <= 2; i++) {
        const base = 0.35 - i * 0.28;
        const bx2 = head.x + A.ux * R * 0.95 - fxx * R * base * 0.9;
        const by2 = head.y + A.uy * R * 0.95 - fyy * R * base * 0.9;
        const fl = Math.sin(r.t * 9 + i * 1.7);
        const hgt = (8 + (2 - Math.abs(i)) * 3.5) * heat * (0.8 + 0.2 * fl) * S;
        const lean = -fxx * (2.5 + fl * 1.5) * S;
        const grd = ctx.createLinearGradient(bx2, by2, bx2 + A.ux * hgt, by2 + A.uy * hgt);
        grd.addColorStop(0, FIRE);
        grd.addColorStop(1, FIRE2);
        ctx.fillStyle = grd;
        ctx.shadowColor = FIRE; ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(bx2 - A.px * 2.4 * S, by2 - A.py * 2.4 * S);
        ctx.quadraticCurveTo(
          bx2 + A.ux * hgt * 0.6 + lean, by2 + A.uy * hgt * 0.6,
          bx2 + A.ux * hgt + lean * 1.6, by2 + A.uy * hgt);
        ctx.quadraticCurveTo(
          bx2 + A.ux * hgt * 0.5 + lean * 0.4, by2 + A.uy * hgt * 0.5,
          bx2 + A.px * 2.4 * S, by2 + A.py * 2.4 * S);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    for (const o of orbs) if (o.front) drawOrb(o);
  },
};

// ══════════════════════════════════════════════════════════════════════════
// ZEFIR — El Vientoveloz (ágil)
// Silueta: bufanda bífida del equipo + pelo en punta barrido por el viento +
// alitas en los tobillos que aletean con la velocidad. Todo en él dice "rápido".
// ══════════════════════════════════════════════════════════════════════════
const ZEFIR = {
  id: 'zefir', nombre: 'Zefir', titulo: 'el Vientoveloz', rol: 'Ágil',
  bio: 'Correo del reino: una vez entregó una carta antes de que la ' +
       'escribieran. Odia frenar — frenar es admitir que el viento ganó.',
  // "Escarlata": el uniforme del correo urgente. Desafío "Cazador".
  palettes: {
    base:      { VEST: '#2f6157', PANTS: '#c8a878', WRAP: '#e8e0cc', BRASS: '#d8a848' },
    escarlata: { VEST: '#7a2f38', PANTS: '#4a4358', WRAP: '#e8e0cc', BRASS: '#e8c25a' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { VEST, PANTS, WRAP, BRASS } =
      this.palettes[player.paletteId] ?? this.palettes.base;
    const spd = Math.hypot(b.vel.x, b.vel.y);

    // Bufanda bífida del equipo: dos cintas sobre la misma cadena física,
    // una entera y otra más corta y oscura — al flamear se separan y se ve
    // el "tenedor" clásico de bufanda de aviador.
    ctx.lineCap = 'round';
    const ribbon = (n, off, col, wMul) => {
      for (let i = 1; i < n; i++) {
        const w = (7.5 - i * 0.9) * S * wMul;
        if (w <= 0.4) continue;
        const fl = Math.sin(r.t * 9 + i * 1.3 + off) * i * 0.7 * S;
        ctx.strokeStyle = r._ink;
        ctx.lineWidth = w + 2.2 * S;
        ctx.beginPath();
        ctx.moveTo(cape[i - 1].x, cape[i - 1].y + off * S + fl * 0.5);
        ctx.lineTo(cape[i].x, cape[i].y + off * S + fl);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(cape[i - 1].x, cape[i - 1].y + off * S + fl * 0.5);
        ctx.lineTo(cape[i].x, cape[i].y + off * S + fl);
        ctx.stroke();
      }
    };
    ribbon(cape.length, 2.5, color, 1);
    ribbon(Math.max(3, cape.length - 2), -3, r._shade(color, -32), 0.8);

    // Miembros traseros, finos
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 7.5 * S, r._shade(PANTS, -34));
    r._limbSeg(ctx, p.chest, p.handB, 6.5 * S, r._shade(VEST, -18));

    // Escoba de carrera: palo fino, nariz oscura, aro de velocidad, timón
    // del equipo en la cola y ramas cortas bien atadas (aerodinámica).
    broomBase(ctx, r, b, {
      wood: '#a8763e', woodDark: '#6b4423', w: 5,
      bind: '#4a3a26',
      bristles: (c, x, y, d, nx, ny) => {
        c.strokeStyle = '#7d5a30';
        c.lineWidth = 2.2 * S;
        for (let i = -1; i <= 1; i++) {
          const a = b.angle + Math.PI + i * 0.07;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * (20 - Math.abs(i) * 2) * S,
                   y + Math.sin(a) * (20 - Math.abs(i) * 2) * S);
          c.stroke();
        }
        // timón: aleta triangular del equipo sobre la cola
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(x + d.x * 2 * S, y + d.y * 2 * S);
        c.lineTo(x - d.x * 6 * S - nx * 11 * S, y - d.y * 6 * S - ny * 11 * S);
        c.lineTo(x - d.x * 9 * S, y - d.y * 9 * S);
        c.closePath(); c.fill();
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(x + d.x * 1 * S, y + d.y * 1 * S);
        c.lineTo(x - d.x * 5.4 * S - nx * 8.8 * S, y - d.y * 5.4 * S - ny * 8.8 * S);
        c.lineTo(x - d.x * 7.8 * S, y - d.y * 7.8 * S);
        c.closePath(); c.fill();
      },
      tip: (c, tip, d, nx, ny) => {
        // nariz cónica oscura
        c.fillStyle = '#3a2c1a';
        c.beginPath();
        c.moveTo(tip.x + d.x * 8 * S, tip.y + d.y * 8 * S);
        c.lineTo(tip.x + nx * 2.8 * S, tip.y + ny * 2.8 * S);
        c.lineTo(tip.x - nx * 2.8 * S, tip.y - ny * 2.8 * S);
        c.closePath(); c.fill();
        // aro de velocidad: se enciende con la rapidez real
        const k = clamp(spd / 900, 0, 1);
        if (k > 0.1) {
          c.strokeStyle = '#bfe9ff';
          c.globalAlpha = k * 0.8;
          c.lineWidth = 1.6 * S;
          c.beginPath();
          c.ellipse(tip.x - d.x * 4 * S, tip.y - d.y * 4 * S, 3 * S, 6.5 * S,
                    Math.atan2(d.y, d.x), 0, TAU);
          c.stroke();
          c.globalAlpha = 1;
        }
      },
    });

    // Pierna delantera + vendas en la pantorrilla
    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 8.5 * S, PANTS);
    ctx.strokeStyle = WRAP;
    ctx.lineWidth = 1.6 * S;
    for (const f of [0.3, 0.48, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(lerp(p.kneeF.x, p.footF.x, f) - 3.5 * S, lerp(p.kneeF.y, p.footF.y, f) - S);
      ctx.lineTo(lerp(p.kneeF.x, p.footF.x, f) + 3.5 * S, lerp(p.kneeF.y, p.footF.y, f) + S);
      ctx.stroke();
    }

    // Chaleco entallado con cierre, cuello alto y cinturón de mensajero con
    // dos bolsitas. La silueta más flaca del plantel: todo en él es liviano.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 9.5 * S, HW_H = 11.5 * S, HW_W = 7.5 * S;
      const at = (f, side, hw) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * hw * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * hw * side,
      });
      const path = () => {
        const c1 = at(1, 1, HW_C), c2 = at(1, -1, HW_C);
        const w1 = at(0.45, -1, HW_W), h1 = at(0, -1, HW_H);
        const h2 = at(0, 1, HW_H), w2 = at(0.45, 1, HW_W);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
        ctx.quadraticCurveTo(w1.x, w1.y, h1.x, h1.y);
        ctx.lineTo(h2.x, h2.y);
        ctx.quadraticCurveTo(w2.x, w2.y, c1.x, c1.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(VEST, 24));
      g.addColorStop(0.5, VEST);
      g.addColorStop(1, r._shade(VEST, -34));
      path(); ctx.fillStyle = g; ctx.fill();
      // cierre + cuello
      ctx.strokeStyle = r._shade(VEST, 46);
      ctx.lineWidth = 1.1 * S;
      ctx.beginPath();
      ctx.moveTo(lerp(p.pelvis.x, p.chest.x, 0.1), lerp(p.pelvis.y, p.chest.y, 0.1));
      ctx.lineTo(lerp(p.pelvis.x, p.chest.x, 0.95), lerp(p.pelvis.y, p.chest.y, 0.95));
      ctx.stroke();
      const n1 = at(0.98, 0.6, HW_C), n2 = at(0.98, -0.6, HW_C);
      ctx.strokeStyle = r._shade(VEST, -20); ctx.lineWidth = 3.4 * S;
      ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.stroke();
      // cinturón + bolsitas
      const bl1 = at(0.3, 1, HW_W + 2 * S), bl2 = at(0.3, -1, HW_W + 2 * S);
      ctx.strokeStyle = '#4a3a26'; ctx.lineWidth = 3.6 * S;
      ctx.beginPath(); ctx.moveTo(bl1.x, bl1.y); ctx.lineTo(bl2.x, bl2.y); ctx.stroke();
      for (const sd of [0.55, -0.45]) {
        const hx = lerp(bl1.x, bl2.x, 0.5 + sd * 0.4), hy = lerp(bl1.y, bl2.y, 0.5 + sd * 0.4);
        ctx.fillStyle = r._ink;
        ctx.fillRect(hx - 2.6 * S, hy, 5.2 * S, 5.6 * S);
        ctx.fillStyle = '#6b5334';
        ctx.fillRect(hx - 2 * S, hy + 0.6 * S, 4 * S, 4.4 * S);
        ctx.fillStyle = BRASS;
        ctx.fillRect(hx - 0.7 * S, hy + 2 * S, 1.4 * S, 1.4 * S);
      }
    }

    // Brazo delantero + vendas del antebrazo
    r._limbSeg(ctx, p.chest, p.handF, 7 * S, VEST);
    ctx.strokeStyle = WRAP;
    ctx.lineWidth = 1.5 * S;
    for (const f of [0.6, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(lerp(p.chest.x, p.handF.x, f) - 3 * S, lerp(p.chest.y, p.handF.y, f) - S);
      ctx.lineTo(lerp(p.chest.x, p.handF.x, f) + 3 * S, lerp(p.chest.y, p.handF.y, f) + S);
      ctx.stroke();
    }

    // Guantes sin dedos: puño + banda clara
    fists(ctx, r, p, '#caa27a');
    ctx.strokeStyle = WRAP;
    ctx.lineWidth = 1.6 * S;
    for (const h of [p.handF, p.handB]) {
      ctx.beginPath(); ctx.arc(h.x, h.y, 4.6 * S, -0.6, 0.9); ctx.stroke();
    }

    // Alitas en los tobillos: aletean más rápido cuanto más rápido vuela
    const flap = Math.sin(r.t * (6 + clamp(spd * 0.02, 0, 14)));
    for (const [foot, sc] of [[p.footF, 1], [p.footB, 0.8]]) {
      const wr = (5.5 + flap * 1.6) * sc * S;
      ctx.fillStyle = r._ink;
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y - 2 * S * sc);
      ctx.lineTo(foot.x - wr * 1.6, foot.y - wr - 2 * S * sc);
      ctx.lineTo(foot.x - wr * 0.5, foot.y - 1 * S * sc);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2ecdd';
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y - 2.4 * S * sc);
      ctx.lineTo(foot.x - wr * 1.35, foot.y - wr * 0.9 - 2.4 * S * sc);
      ctx.lineTo(foot.x - wr * 0.45, foot.y - 1.6 * S * sc);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color;     // puntas de pluma del equipo
      ctx.lineWidth = 1.1 * S;
      ctx.beginPath();
      ctx.moveTo(foot.x - wr * 1.35, foot.y - wr * 0.9 - 2.4 * S * sc);
      ctx.lineTo(foot.x - wr * 0.9, foot.y - wr * 0.5 - 2 * S * sc);
      ctx.stroke();
    }

    // Cabeza: pelo en punta barrido por el rumbo, antiparras en la frente,
    // sonrisa enorme y una cicatriz chiquita — cara de nunca haber frenado.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 10.5 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.4 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade('#caa27a', 20));
      gf.addColorStop(1, r._shade('#caa27a', -22));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // pelo: puntas barridas EN CONTRA del rumbo (reactivo a la velocidad)
      let wx = -fxx, wy = -fyy;
      if (fx.look && spd > 60) {
        const ll = Math.hypot(fx.look.x, fx.look.y) || 1;
        wx = -fx.look.x / ll; wy = -fx.look.y / ll;
      }
      const HAIRC = '#6b4a2f';
      for (let i = -1; i <= 2; i++) {
        const base = 0.55 - i * 0.35;
        const hx2 = head.x + A.ux * R * 0.85 + fxx * R * base * 0.55;
        const hy2 = head.y + A.uy * R * 0.85 + fyy * R * base * 0.55;
        const len = (7 + (2 - Math.abs(i - 0.5)) * 3) * S;
        ctx.fillStyle = i % 2 ? HAIRC : r._shade(HAIRC, -16);
        ctx.beginPath();
        ctx.moveTo(hx2 - A.px * 2.2 * S, hy2 - A.py * 2.2 * S);
        ctx.lineTo(hx2 + A.ux * len * 0.5 + wx * len, hy2 + A.uy * len * 0.5 + wy * len);
        ctx.lineTo(hx2 + A.px * 2.2 * S, hy2 + A.py * 2.2 * S);
        ctx.closePath(); ctx.fill();
      }
      // antiparras en la frente: correa + dos lentes
      ctx.strokeStyle = '#2a2136';
      ctx.lineWidth = 2.6 * S;
      ctx.beginPath();
      ctx.arc(head.x, head.y, R * 0.98,
              Math.atan2(A.uy, A.ux) - 1.25, Math.atan2(A.uy, A.ux) + 1.25);
      ctx.stroke();
      for (const sgn of [0.45, -0.45]) {
        const gx = head.x + A.ux * R * 0.78 + A.px * sgn * R * 0.55;
        const gy = head.y + A.uy * R * 0.78 + A.py * sgn * R * 0.55;
        ctx.fillStyle = r._ink;
        ctx.beginPath(); ctx.arc(gx, gy, 3.4 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = BRASS;
        ctx.beginPath(); ctx.arc(gx, gy, 2.8 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9fd8e8';
        ctx.beginPath(); ctx.arc(gx, gy, 1.8 * S, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8f8ff';
        ctx.beginPath(); ctx.arc(gx - 0.6 * S, gy - 0.6 * S, 0.7 * S, 0, TAU); ctx.fill();
      }
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 10.5 });
      // sonrisa enorme
      ctx.strokeStyle = '#7a4a3a';
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.34 - A.ux * R * 0.3,
              head.y + fyy * R * 0.34 - A.uy * R * 0.3, R * 0.34,
              Math.atan2(fyy, fxx) - 0.9, Math.atan2(fyy, fxx) + 1.0);
      ctx.stroke();
      // cicatriz en el pómulo trasero
      ctx.strokeStyle = r._shade('#caa27a', -40);
      ctx.lineWidth = 1 * S;
      ctx.beginPath();
      ctx.moveTo(head.x - fxx * R * 0.5, head.y - fyy * R * 0.5 - A.uy * R * 0.1);
      ctx.lineTo(head.x - fxx * R * 0.62, head.y - fyy * R * 0.62 - A.uy * R * 0.34);
      ctx.stroke();
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// ESTELAS — la firma de cada personaje en el aire
// ══════════════════════════════════════════════════════════════════════════
// Cada uno deja un rastro propio al volar, y al usar el turbo lo exagera.
// La identidad no puede ser solo el color: si las cuatro estelas son las
// mismas chispas pintadas distinto, de lejos son todas iguales. Por eso
// cambia también la FÍSICA — qué pesa y qué flota, qué vive mucho y qué
// parpadea, qué sale derecho y qué gira.
//
//   trail(particles, x, y, dirX, dirY, power, boost, color)
//     x,y        cola de la escoba
//     dirX,dirY  hacia dónde apunta (la estela sale al revés)
//     power      0..1 propulsión/velocidad
//     boost      0..1 turbo
//     color      color del EQUIPO — un toque, para no perder de qué lado juega
//
// Nota de rendimiento: el tope de partículas es 600 y ya lo consume el
// partido entero (4 jugadores + pelota + orbes). Por eso cada estela emite
// con probabilidad, no a chorro: el gasto por jugador queda acotado.
const rnd = (a, b) => a + Math.random() * (b - a);

// ── Aldus, el Errante — chispa mágica clásica ─────────────────────────────
// El de siempre: la estela con la que nació el juego. Dorado y celeste, sin
// personalidad marcada a propósito — es el punto de comparación contra el
// que se leen las otras cuatro.
function trailMago(particles, x, y, dirX, dirY, power, boost, color) {
  particles.magicTrail(x, y, dirX, dirY, power, boost, color);
}

// ── Valka, la Escudera — chispas de acero ─────────────────────────────────
// No hace magia: hace FUERZA. Deja el chisperío de un yunque — partículas
// que salen en abanico corto, caen rápido y se apagan enseguida, como el
// metal al rojo saltando del golpe. Con turbo, la fricción se enciende.
function trailValka(particles, x, y, dirX, dirY, power, boost, color) {
  if (Math.random() > 0.26 + power * 0.6) return;
  const px = -dirY, py = dirX;
  const s = rnd(60, 200) * (0.5 + power);
  const n = 1 + (Math.random() < boost ? 1 : 0);

  for (let i = 0; i < n; i++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    particles.spawn(
      x + rnd(-4, 4), y + rnd(-4, 4),
      -dirX * s + px * side * rnd(20, 90) * (1 + boost),
      -dirY * s + py * side * rnd(20, 90) * (1 + boost),
      rnd(0.16, 0.34),                       // chispa de yunque: vida corta
      rnd(1.8, 3.6) + boost * 1.6,           // finita y dura
      Math.random() < 0.4 ? '#fff1c4'        // acero al blanco
        : Math.random() < 0.6 ? '#ffb347'    // al rojo
          : '#b9c2cf',                       // esquirla fría (su acero)
      rnd(260, 520),                          // pesa: cae como viruta
    );
  }
  // Destello de equipo ocasional: mantiene legible el bando
  if (Math.random() < 0.10 + boost * 0.18) {
    particles.spawn(x, y, -dirX * s * 0.7, -dirY * s * 0.7,
      rnd(0.2, 0.4), rnd(2.5, 4.5) + boost * 2, color, 120);
  }
}

// ── Mordrak, el Brujo del Pantano — humo de ciénaga ───────────────────────
// La estela más oscura y sucia del plantel. Volutas moradas casi negras que
// PESAN: se hunden en vez de subir, viven mucho y se quedan colgadas como
// niebla de pantano. De lejos parece que arrastra su propia noche.
function trailMordrak(particles, x, y, dirX, dirY, power, boost, color) {
  // Emite menos seguido que el resto a propósito: sus volutas viven el doble
  // (~1.2 s), así que a igual ritmo acumulaba el triple de partículas. Con 4
  // Mordrak a fondo llegaba a 497 de las 600 del tope, y el estallido del gol
  // ya no entraba — se recortaba solo. Menos densidad de emisión, misma
  // presencia en pantalla porque cada voluta dura mucho.
  if (Math.random() > 0.20 + power * 0.40) return;
  const px = -dirY, py = dirX;
  // Serpenteo lento: el humo no sale derecho, ondula al alejarse
  const ph = performance.now() / 1000 * 4.5;
  const wob = Math.sin(ph) * (10 + boost * 22);
  const s = rnd(25, 95) * (0.5 + power);

  for (const side of [1, -1]) {
    if (side < 0 && Math.random() < 0.4) return;   // el par no siempre cierra
    particles.spawn(
      x + px * side * rnd(1, 8), y + py * side * rnd(1, 8),
      -dirX * s + px * side * wob + rnd(-18, 18),
      -dirY * s + py * side * wob + rnd(-18, 18),
      rnd(0.45, 0.85) + boost * 0.3,         // se queda: niebla, no chispa
      rnd(6, 12) + boost * 5,                // volutas gordas
      Math.random() < 0.45 ? '#241a38'       // su túnica, casi negro
        : Math.random() < 0.6 ? '#3b2b52'    // morado de ciénaga
          : '#6b4a8a',                       // realce apenas visible
      rnd(50, 140),                          // se HUNDE: humo pesado
    );
  }
  // Brasa de brujería: el brillo del equipo, que en él ES el acento
  if (Math.random() < 0.16 + boost * 0.22) {
    particles.spawn(x + rnd(-3, 3), y + rnd(-3, 3),
      -dirX * s * 1.4, -dirY * s * 1.4,
      rnd(0.25, 0.5), rnd(2, 4) + boost * 2, color, -20);
  }
}

// ── Ízar, el Elemental — fuego e hielo a la vez ───────────────────────────
// Su gracia es la dualidad: la mano derecha quema y la izquierda congela.
// La estela emite las DOS a la vez, cada una con física opuesta — las ascuas
// suben y se apagan, los cristales caen y se quedan. El resultado es una
// estela que se abre en dos capas, cálida arriba y fría abajo.
function trailIzar(particles, x, y, dirX, dirY, power, boost, color) {
  if (Math.random() > 0.32 + power * 0.68) return;
  const px = -dirY, py = dirX;
  const s = rnd(45, 165) * (0.5 + power);
  // Alterna lado: el fuego sale por una mano y el hielo por la otra
  const side = Math.random() < 0.5 ? 1 : -1;

  if (side > 0) {
    // FUEGO: sube, se apaga rápido, amarillo→naranja
    particles.spawn(
      x + px * rnd(2, 9), y + py * rnd(2, 9),
      -dirX * s + rnd(-30, 30), -dirY * s + rnd(-30, 30) - rnd(20, 70),
      rnd(0.3, 0.62), rnd(3.5, 7.5) + boost * 3.5,
      Math.random() < 0.4 ? '#ffd76a' : (Math.random() < 0.6 ? '#ff8a3c' : '#ff5a1f'),
      rnd(-190, -80),                        // ascua: SUBE
    );
  } else {
    // HIELO: cae despacio, dura más, celeste→blanco
    particles.spawn(
      x - px * rnd(2, 9), y - py * rnd(2, 9),
      -dirX * s * 0.75 + rnd(-22, 22), -dirY * s * 0.75 + rnd(-22, 22),
      rnd(0.5, 0.95) + boost * 0.3, rnd(2.5, 5) + boost * 2.5,
      Math.random() < 0.45 ? '#e8f8ff' : (Math.random() < 0.6 ? '#7fd8ff' : '#4aa8d8'),
      rnd(70, 200),                          // cristal: CAE
    );
  }
  // Con turbo los dos elementos chocan: chispa blanca en el medio
  if (boost > 0.4 && Math.random() < boost * 0.3) {
    particles.spawn(x, y, rnd(-90, 90), rnd(-90, 90),
      rnd(0.12, 0.28), rnd(3, 6), '#ffffff', 0);
  }
}

// ── Zefir, el Vientoveloz — corrientes de aire ────────────────────────────
// El más liviano: todo SUBE y se abre. Dos hebras que giran en espiral (el
// ángulo avanza parejo con el tiempo, no al azar) y se cruzan formando el
// remolino. Casi no ensucia el aire: se va enseguida hacia arriba, que es
// justo lo que uno espera de alguien que odia frenar.
function trailZefir(particles, x, y, dirX, dirY, power, boost, color) {
  if (Math.random() > 0.34 + power * 0.66) return;
  const px = -dirY, py = dirX;
  const spin = performance.now() / 1000 * 12;
  const s = rnd(70, 230) * (0.5 + power);

  for (const side of [1, -1]) {
    const swirl = Math.sin(spin + (side > 0 ? 0 : Math.PI)) * (20 + boost * 42);
    particles.spawn(
      x + px * side * rnd(3, 13), y + py * side * rnd(3, 13),
      -dirX * s + px * swirl + rnd(-16, 16),
      -dirY * s + py * swirl + rnd(-16, 16),
      rnd(0.26, 0.55) + boost * 0.22,        // se disipa rápido: es aire
      rnd(2.2, 4.8) + boost * 2.8,
      Math.random() < 0.4 ? '#e8e0cc'        // sus vendas
        : Math.random() < 0.6 ? '#7ee8a2'    // verde de velocidad
          : '#d8fff0',
      rnd(-230, -110),                       // SUBE fuerte: viento
    );
  }
  // Con turbo suelta plumas del color del equipo (sus alitas de tobillo)
  if (boost > 0.35 && Math.random() < boost * 0.25) {
    particles.spawn(x + rnd(-8, 8), y + rnd(-8, 8),
      -dirX * s * 0.5 + rnd(-40, 40), -dirY * s * 0.5 + rnd(-40, 40),
      rnd(0.35, 0.7), rnd(3, 6), color, rnd(-150, -60));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PETRA — La Montaña (tanque)
// Silueta: una mole. Rocas apiladas con musgo, núcleo de cristal del equipo
// latiendo en el pecho, brotecito en la cabeza. La escoba es una columna de
// piedra con esquirlas levitando de cola. Todo en ella dice "no me muevas".
// ══════════════════════════════════════════════════════════════════════════
const PETRA = {
  id: 'petra', nombre: 'Petra', titulo: 'la Montaña', rol: 'Tanque',
  bio: 'Una golem que aprendió a volar por pura terquedad: la piedra no ' +
       'flota, pero nadie se lo dijo a tiempo. Lenta para hablar, imposible ' +
       'de frenar.',
  palettes: {
    base: { STONE: '#8d8a96', STONE_D: '#5f5c6a', MOSS: '#5a7a4a' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { STONE, STONE_D, MOSS } = this.palettes.base;
    const boost = b.boostPower || 0;

    // Escombros orbitando la espalda (la cadena de la capa): pedruscos
    // angulares que giran lento — a Petra la siguen pedazos de sí misma.
    for (let i = 1; i < cape.length; i++) {
      const rad = (5.5 - i * 0.6) * S;
      if (rad <= 1) continue;
      const rot = r.t * (0.8 + i * 0.3) + i * 2;
      ctx.save();
      ctx.translate(cape[i].x, cape[i].y + Math.sin(r.t * 2 + i) * 3 * S);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.85 - i * 0.1;
      ctx.fillStyle = r._ink;
      ctx.fillRect(-rad - 1.2 * S, -rad - 1.2 * S, rad * 2 + 2.4 * S, rad * 2 + 2.4 * S);
      ctx.fillStyle = i % 2 ? STONE : STONE_D;
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Miembros: los más gruesos del plantel
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 12.5 * S, STONE_D);
    r._limbSeg(ctx, p.chest, p.handB, 11 * S, STONE_D);

    // Escoba-columna: piedra tallada con bandas, cola de esquirlas
    // levitantes y un cristal del equipo en la punta.
    broomBase(ctx, r, b, {
      wood: STONE, woodDark: STONE_D, woodLight: r._shade(STONE, 22), w: 10,
      bind: STONE_D,
      bristles: (c, x, y, d, nx, ny) => {
        // esquirlas flotando en abanico, sin tocar el palo
        for (let i = -2; i <= 2; i++) {
          const a = b.angle + Math.PI + i * 0.22;
          const dist = (16 + Math.abs(i) * 4 + Math.sin(r.t * 2.4 + i * 2) * 3) * S;
          const ex = x + Math.cos(a) * dist, ey = y + Math.sin(a) * dist;
          const sz = (4.5 - Math.abs(i)) * S;
          c.save();
          c.translate(ex, ey);
          c.rotate(r.t * 1.5 + i);
          c.fillStyle = r._ink;
          c.fillRect(-sz - S, -sz - S, sz * 2 + 2 * S, sz * 2 + 2 * S);
          c.fillStyle = i % 2 ? STONE : STONE_D;
          c.fillRect(-sz, -sz, sz * 2, sz * 2);
          c.restore();
        }
      },
      tip: (c, tip, d, nx, ny) => {
        const pulse = 0.6 + 0.4 * Math.sin(r.t * 3) + boost * 0.4;
        c.fillStyle = r._ink;
        c.beginPath();
        c.moveTo(tip.x + d.x * 9 * S, tip.y + d.y * 9 * S);
        c.lineTo(tip.x + nx * 5 * S, tip.y + ny * 5 * S);
        c.lineTo(tip.x - d.x * 4 * S, tip.y - d.y * 4 * S);
        c.lineTo(tip.x - nx * 5 * S, tip.y - ny * 5 * S);
        c.closePath(); c.fill();
        c.fillStyle = color;
        c.shadowColor = color;
        c.shadowBlur = 8 * pulse;
        c.beginPath();
        c.moveTo(tip.x + d.x * 7 * S, tip.y + d.y * 7 * S);
        c.lineTo(tip.x + nx * 3.4 * S, tip.y + ny * 3.4 * S);
        c.lineTo(tip.x - d.x * 2.6 * S, tip.y - d.y * 2.6 * S);
        c.lineTo(tip.x - nx * 3.4 * S, tip.y - ny * 3.4 * S);
        c.closePath(); c.fill();
        c.shadowBlur = 0;
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 13.5 * S, STONE);

    // Torso: canto rodado gigante con grietas, musgo y el NÚCLEO del equipo
    {
      const A = axis(p.pelvis, p.chest);
      const HW = 17 * S;
      const path = () => {
        ctx.beginPath();
        ctx.ellipse(
          (p.pelvis.x + p.chest.x) / 2, (p.pelvis.y + p.chest.y) / 2,
          HW, A.len * 0.72 + 6 * S, Math.atan2(A.uy, A.ux) + Math.PI / 2, 0, TAU);
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.6 * S; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW, p.chest.y + A.py * HW,
        p.chest.x - A.px * HW, p.chest.y - A.py * HW);
      g.addColorStop(0, r._shade(STONE, 20));
      g.addColorStop(1, STONE_D);
      path(); ctx.fillStyle = g; ctx.fill();
      // grietas: se encienden del color del equipo al acelerar
      ctx.strokeStyle = boost > 0.2 ? color : r._shade(STONE_D, -20);
      ctx.globalAlpha = 0.5 + boost * 0.5;
      ctx.lineWidth = 1.4 * S;
      for (const [f, side, len] of [[0.7, 0.5, 7], [0.35, -0.6, 9], [0.15, 0.3, 6]]) {
        const cx2 = lerp(p.pelvis.x, p.chest.x, f) + A.px * side * HW * 0.6;
        const cy2 = lerp(p.pelvis.y, p.chest.y, f) + A.py * side * HW * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx2, cy2);
        ctx.lineTo(cx2 + A.px * side * len * S * 0.4 - A.ux * len * S * 0.5,
                   cy2 + A.py * side * len * S * 0.4 - A.uy * len * S * 0.5);
        ctx.lineTo(cx2 + A.px * side * len * S * 0.7 - A.ux * len * S * 0.9,
                   cy2 + A.py * side * len * S * 0.7 - A.uy * len * S * 0.9);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // musgo: manchas orgánicas en el hombro de atrás
      ctx.fillStyle = MOSS;
      ctx.globalAlpha = 0.85;
      for (const [f, side, sz] of [[0.85, -0.5, 5], [0.75, -0.75, 3.4], [0.9, -0.2, 2.6]]) {
        ctx.beginPath();
        ctx.arc(lerp(p.pelvis.x, p.chest.x, f) + A.px * side * HW * 0.7,
                lerp(p.pelvis.y, p.chest.y, f) + A.py * side * HW * 0.7, sz * S, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // núcleo: cristal del equipo latiendo en el pecho
      const pulse = 0.65 + 0.35 * Math.sin(r.t * 2.6) + boost * 0.3;
      const nx2 = lerp(p.pelvis.x, p.chest.x, 0.62), ny2 = lerp(p.pelvis.y, p.chest.y, 0.62);
      ctx.save();
      ctx.translate(nx2, ny2);
      ctx.rotate(Math.atan2(A.uy, A.ux));
      ctx.fillStyle = r._ink;
      ctx.beginPath();
      ctx.moveTo(6.6 * S, 0); ctx.lineTo(0, 5 * S); ctx.lineTo(-6.6 * S, 0); ctx.lineTo(0, -5 * S);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12 * pulse;
      ctx.beginPath();
      ctx.moveTo(5 * S, 0); ctx.lineTo(0, 3.6 * S); ctx.lineTo(-5 * S, 0); ctx.lineTo(0, -3.6 * S);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    r._limbSeg(ctx, p.chest, p.handF, 12 * S, STONE);

    // Puños de roca, más grandes que los de cualquiera
    for (const [h, rad] of [[p.handF, 8], [p.handB, 7]]) {
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * S + 1.6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = STONE;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * S, 0, TAU); ctx.fill();
      ctx.strokeStyle = STONE_D;
      ctx.lineWidth = 1.2 * S;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * 0.55 * S, -0.8, 1.2); ctx.stroke();
    }

    // Cabeza: peñasco con ceja de piedra, ojos del equipo en cuencas
    // profundas, boca-grieta y un BROTE verde creciendo arriba.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11.5 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.6 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(STONE, 16));
      gf.addColorStop(1, STONE_D);
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // ceja: losa de piedra sobre los ojos
      ctx.strokeStyle = STONE_D;
      ctx.lineWidth = 4 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(head.x + fxx * R * 0.75 + A.ux * R * 0.35, head.y + fyy * R * 0.75 + A.uy * R * 0.35);
      ctx.lineTo(head.x - fxx * R * 0.1 + A.ux * R * 0.45, head.y - fyy * R * 0.1 + A.uy * R * 0.45);
      ctx.stroke();
      // ojos: puntos del equipo en cuencas oscuras (cruces al aturdirse)
      if (fx.slam > 0.05) {
        eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11.5 });
      } else {
        for (const sgn of [0.5, -0.5]) {
          const ex = head.x + fxx * R * 0.42 + A.ux * R * sgn * 0.45;
          const ey = head.y + fyy * R * 0.42 + A.uy * R * sgn * 0.45;
          ctx.fillStyle = '#191623';
          ctx.beginPath(); ctx.arc(ex, ey, 2.8 * S, 0, TAU); ctx.fill();
          ctx.fillStyle = color;
          ctx.shadowColor = color; ctx.shadowBlur = 5;
          ctx.beginPath(); ctx.arc(ex, ey, 1.3 * S, 0, TAU); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      // boca: grieta horizontal seria
      ctx.strokeStyle = r._shade(STONE_D, -24);
      ctx.lineWidth = 1.4 * S;
      ctx.beginPath();
      ctx.moveTo(head.x + fxx * R * 0.55 - A.ux * R * 0.4, head.y + fyy * R * 0.55 - A.uy * R * 0.4);
      ctx.lineTo(head.x + fxx * R * 0.2 - A.ux * R * 0.42, head.y + fyy * R * 0.2 - A.uy * R * 0.42);
      ctx.stroke();
      // brote: dos hojitas en la coronilla — la montaña está viva
      const bx = head.x + A.ux * (R + 1 * S), by = head.y + A.uy * (R + 1 * S);
      ctx.strokeStyle = '#4a7a3a';
      ctx.lineWidth = 1.6 * S;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + A.ux * 5 * S, by + A.uy * 5 * S);
      ctx.stroke();
      ctx.fillStyle = MOSS;
      for (const side of [1, -1]) {
        ctx.beginPath();
        ctx.ellipse(bx + A.ux * 5.5 * S + A.px * side * 3 * S,
                    by + A.uy * 5.5 * S + A.py * side * 3 * S,
                    3.4 * S, 1.7 * S,
                    Math.atan2(A.py, A.px) + side * 0.5, 0, TAU);
        ctx.fill();
      }
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// HILARIA — La Tejedora (abuela bruja)
// Silueta: rodete blanco con agujas de tejer clavadas, anteojos, chal a
// cuadros y una hebra de lana del color del equipo que arrastra un OVILLO.
// Dulzura letal: la escoba más prolija del plantel.
// ══════════════════════════════════════════════════════════════════════════
const HILARIA = {
  id: 'hilaria', nombre: 'Hilaria', titulo: 'la Tejedora', rol: 'Abuela bruja',
  bio: 'Tejió su primera bufanda hace doscientos años y todavía no paró. Te ' +
       'sirve el té, te pregunta por tu madre y te clava tres goles con la ' +
       'misma sonrisa.',
  palettes: {
    base: { SHAWL: '#a34f5f', SHAWL_D: '#7a3a48', DRESS: '#4a4e6e', HAIR: '#e8e2d0' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { SHAWL, SHAWL_D, DRESS, HAIR } = this.palettes.base;

    // Lana: una hebra del color del equipo que termina en un ovillo que se
    // hamaca. Nadie más arrastra su tejido por la cancha.
    ctx.lineCap = 'round';
    ctx.strokeStyle = r._ink;
    ctx.lineWidth = 3.4 * S;
    ctx.beginPath();
    ctx.moveTo(cape[0].x, cape[0].y);
    for (let i = 1; i < cape.length; i++) {
      ctx.lineTo(cape[i].x, cape[i].y + Math.sin(r.t * 5 + i * 1.4) * 2.4 * S);
    }
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.9 * S;
    ctx.beginPath();
    ctx.moveTo(cape[0].x, cape[0].y);
    for (let i = 1; i < cape.length; i++) {
      ctx.lineTo(cape[i].x, cape[i].y + Math.sin(r.t * 5 + i * 1.4) * 2.4 * S);
    }
    ctx.stroke();
    // el ovillo
    const ov = cape[cape.length - 1];
    ctx.fillStyle = r._ink;
    ctx.beginPath(); ctx.arc(ov.x, ov.y, 6.6 * S, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(ov.x, ov.y, 5.4 * S, 0, TAU); ctx.fill();
    ctx.strokeStyle = r._shade(color, -40);
    ctx.lineWidth = 0.9 * S;
    for (const a of [0.4, 1.6, 2.7]) {
      ctx.beginPath();
      ctx.arc(ov.x, ov.y, 4.4 * S, a, a + 2.2);
      ctx.stroke();
    }

    // Piernas con medias oscuras, finitas (la pollera tapa los muslos)
    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 6.5 * S, r._shade(DRESS, -26));
    r._limbSeg(ctx, p.chest, p.handB, 6.5 * S, SHAWL_D);

    // La escoba ORIGINAL, cuidada 60 años: palo lustrado, ramas parejas
    // recortadas al ras, moño del equipo en la atadura y una tetera colgando.
    broomBase(ctx, r, b, {
      wood: '#8a5a2b', woodDark: '#5d3a17', woodLight: '#b98a4e', w: 6.5,
      rings: '#c9a04e', ringAt: [0.42],
      bristles: (c, x, y, d, nx, ny) => {
        // abanico PERFECTO: mismo largo, mismo espaciado (está orgullosa)
        c.strokeStyle = '#c9a04e';
        c.lineWidth = 2.6 * S;
        for (let i = -3; i <= 3; i++) {
          const a = b.angle + Math.PI + i * 0.11;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * 26 * S, y + Math.sin(a) * 26 * S);
          c.stroke();
        }
        // corte parejo: arco que une las puntas
        c.strokeStyle = '#a8843e';
        c.lineWidth = 1.4 * S;
        c.beginPath();
        c.arc(x, y, 26 * S, b.angle + Math.PI - 0.36, b.angle + Math.PI + 0.36);
        c.stroke();
        // moño del equipo en la atadura
        const bx2 = x + d.x * 2 * S, by2 = y + d.y * 2 * S;
        c.fillStyle = color;
        for (const side of [1, -1]) {
          c.beginPath();
          c.moveTo(bx2, by2);
          c.lineTo(bx2 + nx * side * 6 * S - d.x * 3 * S, by2 + ny * side * 6 * S - d.y * 3 * S);
          c.lineTo(bx2 + nx * side * 5 * S + d.x * 2 * S, by2 + ny * side * 5 * S + d.y * 2 * S);
          c.closePath(); c.fill();
        }
        c.beginPath(); c.arc(bx2, by2, 1.8 * S, 0, TAU); c.fill();
        // tetera colgando, hamacándose
        const sw = Math.sin(r.t * 2.8) * 0.4;
        const tx2 = x + d.x * 14 * S + nx * (11 * S + sw * 4 * S);
        const ty2 = y + d.y * 14 * S + ny * (11 * S + sw * 4 * S);
        c.strokeStyle = '#7a6a4e';
        c.lineWidth = 0.9 * S;
        c.beginPath();
        c.moveTo(x + d.x * 14 * S, y + d.y * 14 * S);
        c.lineTo(tx2, ty2);
        c.stroke();
        c.fillStyle = r._ink;
        c.beginPath(); c.ellipse(tx2, ty2, 4.6 * S, 3.6 * S, 0, 0, TAU); c.fill();
        c.fillStyle = '#d8cdb0';
        c.beginPath(); c.ellipse(tx2, ty2, 3.6 * S, 2.8 * S, 0, 0, TAU); c.fill();
        c.strokeStyle = '#d8cdb0';
        c.lineWidth = 1.2 * S;
        c.beginPath(); c.arc(tx2 - 4.4 * S, ty2, 2 * S, 0.6, 4.2); c.stroke();
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 7 * S, r._shade(DRESS, -20));

    // Vestido con POLLERA acampanada que tapa los muslos + chal a cuadros
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 10 * S, HW_H = 13 * S;
      // pollera: campana que baja de la pelvis hacia las rodillas
      const kx = (p.kneeF.x + p.kneeB.x) / 2, ky = (p.kneeF.y + p.kneeB.y) / 2;
      ctx.beginPath();
      ctx.moveTo(p.pelvis.x + A.px * HW_H, p.pelvis.y + A.py * HW_H);
      ctx.quadraticCurveTo(
        kx + A.px * 15 * S, ky + A.py * 15 * S,
        kx + A.px * 12 * S - A.ux * 4 * S, ky + A.py * 12 * S - A.uy * 4 * S);
      ctx.lineTo(kx - A.px * 12 * S - A.ux * 4 * S, ky - A.py * 12 * S - A.uy * 4 * S);
      ctx.quadraticCurveTo(
        kx - A.px * 15 * S, ky - A.py * 15 * S,
        p.pelvis.x - A.px * HW_H, p.pelvis.y - A.py * HW_H);
      ctx.closePath();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2.8 * S; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = DRESS;
      ctx.fill();
      // tablas de la pollera
      ctx.strokeStyle = r._shade(DRESS, -22);
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.2 * S;
      for (const f of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(p.pelvis.x + A.px * f * HW_H * 0.8, p.pelvis.y + A.py * f * HW_H * 0.8);
        ctx.lineTo(kx + A.px * f * 13 * S - A.ux * 3 * S, ky + A.py * f * 13 * S - A.uy * 3 * S);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // corpiño del vestido
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C);
        ctx.lineTo(p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
        ctx.lineTo(p.pelvis.x - A.px * HW_H, p.pelvis.y - A.py * HW_H);
        ctx.lineTo(p.pelvis.x + A.px * HW_H, p.pelvis.y + A.py * HW_H);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3 * S; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(DRESS, 18));
      g.addColorStop(1, r._shade(DRESS, -22));
      path(); ctx.fillStyle = g; ctx.fill();
      // chal a cuadros sobre los hombros, con flecos
      const shawl = () => {
        ctx.beginPath();
        ctx.moveTo(p.chest.x + A.px * (HW_C + 3 * S), p.chest.y + A.py * (HW_C + 3 * S));
        ctx.lineTo(p.chest.x - A.px * (HW_C + 3 * S), p.chest.y - A.py * (HW_C + 3 * S));
        ctx.lineTo(lerp(p.pelvis.x, p.chest.x, 0.45) - A.px * HW_C * 0.8,
                   lerp(p.pelvis.y, p.chest.y, 0.45) - A.py * HW_C * 0.8);
        ctx.lineTo(lerp(p.pelvis.x, p.chest.x, 0.45) + A.px * HW_C * 0.8,
                   lerp(p.pelvis.y, p.chest.y, 0.45) + A.py * HW_C * 0.8);
        ctx.closePath();
      };
      shawl();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2.4 * S; ctx.stroke();
      shawl(); ctx.fillStyle = SHAWL; ctx.fill();
      // cuadros del tejido
      ctx.strokeStyle = SHAWL_D;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1 * S;
      for (const f of [0.55, 0.75, 0.95]) {
        const lx = lerp(p.pelvis.x, p.chest.x, f), ly = lerp(p.pelvis.y, p.chest.y, f);
        ctx.beginPath();
        ctx.moveTo(lx + A.px * HW_C, ly + A.py * HW_C);
        ctx.lineTo(lx - A.px * HW_C, ly - A.py * HW_C);
        ctx.stroke();
      }
      for (const s2 of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(p.chest.x + A.px * s2 * HW_C, p.chest.y + A.py * s2 * HW_C);
        ctx.lineTo(lerp(p.pelvis.x, p.chest.x, 0.45) + A.px * s2 * HW_C * 0.8,
                   lerp(p.pelvis.y, p.chest.y, 0.45) + A.py * s2 * HW_C * 0.8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // broche del equipo cerrando el chal
      const brx = lerp(p.pelvis.x, p.chest.x, 0.8) + A.px * fx.facing * 4 * S;
      const bry = lerp(p.pelvis.y, p.chest.y, 0.8) + A.py * fx.facing * 4 * S;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(brx, bry, 3.6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(brx, bry, 2.6 * S, 0, TAU); ctx.fill();
    }

    r._limbSeg(ctx, p.chest, p.handF, 7 * S, SHAWL);

    // Manos con guantes de encaje (mitones)
    fists(ctx, r, p, '#d8cdb0');

    // Cabeza: rodete con agujas, anteojos, cachetes rosados, sonrisa dulce
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 10.5 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.4 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 22));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -16));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // pelo blanco: casquete + RODETE arriba-atrás
      ctx.fillStyle = r._ink;
      ctx.beginPath();
      ctx.arc(head.x + A.ux * R * 0.35 - fxx * R * 0.3, head.y + A.uy * R * 0.35 - fyy * R * 0.3,
              R * 0.95, 0, TAU);
      ctx.fill();
      ctx.fillStyle = HAIR;
      ctx.beginPath();
      ctx.arc(head.x + A.ux * R * 0.35 - fxx * R * 0.32, head.y + A.uy * R * 0.35 - fyy * R * 0.32,
              R * 0.84, 0, TAU);
      ctx.fill();
      // frente despejada (recorte de cara sobre el pelo)
      ctx.fillStyle = gf;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.28, head.y + fyy * R * 0.28, R * 0.82, 0, TAU);
      ctx.fill();
      const bunX = head.x + A.ux * R * 1.05 - fxx * R * 0.55;
      const bunY = head.y + A.uy * R * 1.05 - fyy * R * 0.55;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(bunX, bunY, 6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = HAIR;
      ctx.beginPath(); ctx.arc(bunX, bunY, 4.9 * S, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#c8c0ae';
      ctx.lineWidth = 0.8 * S;
      ctx.beginPath(); ctx.arc(bunX, bunY, 3.2 * S, 0.5, 3.6); ctx.stroke();
      // agujas de tejer cruzadas en el rodete
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 1.6 * S;
      ctx.lineCap = 'round';
      for (const a of [-0.5, 0.6]) {
        const ang = Math.atan2(A.uy, A.ux) + a;
        ctx.beginPath();
        ctx.moveTo(bunX - Math.cos(ang) * 6 * S, bunY - Math.sin(ang) * 6 * S);
        ctx.lineTo(bunX + Math.cos(ang) * 11 * S, bunY + Math.sin(ang) * 11 * S);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bunX + Math.cos(ang) * 11 * S, bunY + Math.sin(ang) * 11 * S, 1.6 * S, 0, TAU);
        ctx.fill();
      }
      // ojos + anteojos redondos con brillo
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 10.5 });
      ctx.strokeStyle = '#c9a04e';
      ctx.lineWidth = 1.1 * S;
      const eb = { x: head.x + fxx * R * 0.34 + A.ux * R * 0.12,
                   y: head.y + fyy * R * 0.34 + A.uy * R * 0.12 };
      const sep = R * 0.30;
      for (const sgn of [0.55, -0.55]) {
        ctx.beginPath();
        ctx.arc(eb.x + A.ux * sep * sgn + fxx * sep * 0.28,
                eb.y + A.uy * sep * sgn + fyy * sep * 0.28, R * 0.32, 0, TAU);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(eb.x + A.ux * sep * 0.25, eb.y + A.uy * sep * 0.25);
      ctx.lineTo(eb.x - A.ux * sep * 0.25, eb.y - A.uy * sep * 0.25);
      ctx.stroke();
      // cachetes rosados + sonrisa
      ctx.fillStyle = 'rgba(230,120,120,0.35)';
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.55 - A.ux * R * 0.15, head.y + fyy * R * 0.55 - A.uy * R * 0.15,
              R * 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#a15a4a';
      ctx.lineWidth = 1.3 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.36 - A.ux * R * 0.34, head.y + fyy * R * 0.36 - A.uy * R * 0.34,
              R * 0.26, Math.atan2(fyy, fxx) - 0.6, Math.atan2(fyy, fxx) + 0.9);
      ctx.stroke();
      // arito de perla
      ctx.fillStyle = '#f2eee2';
      ctx.beginPath();
      ctx.arc(head.x - fxx * R * 0.85, head.y - fyy * R * 0.85 - A.uy * R * 0.05, 1.5 * S, 0, TAU);
      ctx.fill();
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// VENDAVAL — El Capitán (corsario del cielo)
// Silueta: tricornio + barba trenzada + una VELA del equipo aparejada en la
// escoba que se infla con la velocidad. Loro en el hombro. Ruido, botín y
// coordenadas gritadas que nadie entiende.
// ══════════════════════════════════════════════════════════════════════════
const VENDAVAL = {
  id: 'vendaval', nombre: 'Vendaval', titulo: 'el Capitán', rol: 'Corsario del cielo',
  bio: 'Perdió el barco en una apuesta y el ojo en otra. La escoba fue la ' +
       'tercera apuesta — esa la ganó. Grita coordenadas que nadie entiende, ' +
       'ni él.',
  palettes: {
    base: { COAT: '#8a2f36', COAT_D: '#5e1f26', GOLD: '#d8a848', SHIRT: '#e8e0cc', BEARD: '#3a2a20' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { COAT, COAT_D, GOLD, SHIRT, BEARD } = this.palettes.base;
    const spd = Math.hypot(b.vel.x, b.vel.y);

    // Faldón del abrigo flameando (la cadena de la capa), con ribete dorado
    const coatPath = (off) => {
      ctx.beginPath();
      ctx.moveTo(cape[0].x, cape[0].y);
      for (let i = 1; i < cape.length; i++) {
        const w = (11 - i * 1.3) * S;
        ctx.lineTo(cape[i].x, cape[i].y + w + off);
      }
      for (let i = cape.length - 1; i >= 0; i--) {
        const w = (11 - i * 1.3) * S;
        ctx.lineTo(cape[i].x, cape[i].y - w + off);
      }
      ctx.closePath();
    };
    coatPath(0);
    ctx.strokeStyle = r._ink; ctx.lineWidth = 2.8 * S; ctx.lineJoin = 'round'; ctx.stroke();
    const gc = ctx.createLinearGradient(cape[0].x, cape[0].y,
      cape[cape.length - 1].x, cape[cape.length - 1].y);
    gc.addColorStop(0, COAT);
    gc.addColorStop(1, COAT_D);
    coatPath(0); ctx.fillStyle = gc; ctx.fill();
    // ribete dorado por el borde inferior
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.2 * S;
    ctx.beginPath();
    ctx.moveTo(cape[0].x, cape[0].y + 10 * S);
    for (let i = 1; i < cape.length; i++) {
      ctx.lineTo(cape[i].x, cape[i].y + (11 - i * 1.3) * S);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 9 * S, COAT_D);
    r._limbSeg(ctx, p.chest, p.handB, 8 * S, COAT_D);

    // Escoba-mástil: palo robusto, VELA triangular del equipo que se infla
    // con la velocidad, cabos deshilachados de cola y punta de bronce.
    broomBase(ctx, r, b, {
      wood: '#6b4a2b', woodDark: '#452e18', w: 7.5,
      rings: '#b8860b', ringAt: [0.34],
      bristles: (c, x, y, d, nx, ny) => {
        // cabos deshilachados: cuerdas sueltas de distinto largo
        c.strokeStyle = '#a8926a';
        c.lineWidth = 2 * S;
        for (let i = -2; i <= 2; i++) {
          const wob = Math.sin(r.t * 4 + i * 2.2) * 0.08;
          const a = b.angle + Math.PI + i * 0.15 + wob;
          const len = (24 - Math.abs(i) * 3 + Math.sin(i * 5.1) * 4) * S;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          c.stroke();
          // nudo en la punta de cada cabo
          c.fillStyle = '#8a744e';
          c.beginPath();
          c.arc(x + Math.cos(a) * len, y + Math.sin(a) * len, 1.5 * S, 0, TAU);
          c.fill();
        }
      },
      tip: (c, tip, d, nx, ny) => {
        // punta de bronce
        c.fillStyle = r._ink;
        c.beginPath(); c.arc(tip.x, tip.y, 4.6 * S, 0, TAU); c.fill();
        c.fillStyle = GOLD;
        c.beginPath(); c.arc(tip.x, tip.y, 3.5 * S, 0, TAU); c.fill();
        c.fillStyle = '#f2e2b0';
        c.beginPath(); c.arc(tip.x - S, tip.y - S, 1.2 * S, 0, TAU); c.fill();
      },
    });

    // VELA: aparejada a un mastilito vertical DELANTE del jinete, cerca de
    // la punta — si queda a mitad del palo se enreda visualmente con el
    // cuerpo. Se infla con la velocidad real: quieta cuelga, a fondo es una
    // panza llena.
    {
      const d = b.dir(), nx = -d.y, ny = d.x;
      const tail = b.tail();
      const baseX = tail.x + d.x * 88 * S, baseY = tail.y + d.y * 88 * S;
      const mastH = 22 * S;
      const topX = baseX + nx * -mastH, topY = baseY + ny * -mastH;
      // mastilito
      ctx.strokeStyle = r._ink;
      ctx.lineWidth = 4.6 * S;
      ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(topX, topY); ctx.stroke();
      ctx.strokeStyle = '#5d3a17';
      ctx.lineWidth = 3 * S;
      ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(topX, topY); ctx.stroke();
      // vela triangular hacia atrás, panza según velocidad
      const belly = (5 + Math.min(spd / 900, 1) * 12) * S;
      const backX = baseX - d.x * 24 * S, backY = baseY - d.y * 24 * S;
      const sail = () => {
        ctx.beginPath();
        ctx.moveTo(topX, topY);
        ctx.quadraticCurveTo(
          (topX + backX) / 2 - nx * belly, (topY + backY) / 2 - ny * belly,
          backX, backY);
        ctx.lineTo(baseX, baseY);
        ctx.closePath();
      };
      sail();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2.2 * S; ctx.stroke();
      sail();
      const gs = ctx.createLinearGradient(topX, topY, backX, backY);
      gs.addColorStop(0, r._shade(color, 24));
      gs.addColorStop(1, r._shade(color, -22));
      ctx.fillStyle = gs;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      // costura de la vela
      ctx.strokeStyle = r._shade(color, -45);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 0.9 * S;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(
        (topX + backX) / 2 - nx * belly * 0.6, (topY + backY) / 2 - ny * belly * 0.6,
        (baseX + backX) / 2, (baseY + backY) / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 10 * S, COAT_D);

    // Abrigo de capitán: doble botonadura dorada, camisa, fajín y hebillón
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 11.5 * S, HW_H = 13 * S;
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1), h1 = at(0, -1, 1.5 * S), h2 = at(0, 1, 1.5 * S);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
        ctx.lineTo(h1.x, h1.y); ctx.lineTo(h2.x, h2.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.2 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(COAT, 18));
      g.addColorStop(0.5, COAT);
      g.addColorStop(1, COAT_D);
      path(); ctx.fillStyle = g; ctx.fill();
      // camisa asomando en V
      const nV = { x: lerp(p.pelvis.x, p.chest.x, 0.68), y: lerp(p.pelvis.y, p.chest.y, 0.68) };
      ctx.beginPath();
      ctx.moveTo(p.chest.x + A.px * HW_C * 0.55, p.chest.y + A.py * HW_C * 0.55);
      ctx.lineTo(nV.x, nV.y);
      ctx.lineTo(p.chest.x - A.px * HW_C * 0.55, p.chest.y - A.py * HW_C * 0.55);
      ctx.closePath();
      ctx.fillStyle = SHIRT;
      ctx.fill();
      // doble botonadura: dos columnas de botones dorados
      ctx.fillStyle = GOLD;
      for (const side of [0.45, -0.45]) {
        for (const f of [0.3, 0.45, 0.6]) {
          ctx.beginPath();
          ctx.arc(lerp(p.pelvis.x, p.chest.x, f) + A.px * side * HW_C,
                  lerp(p.pelvis.y, p.chest.y, f) + A.py * side * HW_C, 1.7 * S, 0, TAU);
          ctx.fill();
        }
      }
      // fajín + hebillón
      const b1 = at(0.22, 1, 1 * S), b2 = at(0.22, -1, 1 * S);
      ctx.strokeStyle = r._ink; ctx.lineWidth = 6.6 * S;
      ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 5 * S;
      ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      const bc = { x: lerp(b1.x, b2.x, 0.5), y: lerp(b1.y, b2.y, 0.5) };
      ctx.fillStyle = GOLD;
      ctx.fillRect(bc.x - 3.6 * S, bc.y - 3 * S, 7.2 * S, 6 * S);
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(bc.x - 1.8 * S, bc.y - 1.4 * S, 3.6 * S, 2.8 * S);
    }

    // LORO del equipo en el hombro de atrás: cuerpo gordito, ala que aletea
    // al acelerar, ojo atento. El compañero de fórmula.
    {
      const A = axis(p.pelvis, p.chest);
      const bk = -fx.facing;
      const lx = p.chest.x + A.px * bk * 16 * S + A.ux * 2 * S;
      const ly = p.chest.y + A.py * bk * 16 * S + A.uy * 2 * S;
      const flap = Math.sin(r.t * (4 + (b.boostPower || 0) * 14)) * 0.4;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.ellipse(lx, ly, 5.4 * S, 6.6 * S, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(lx, ly, 4.4 * S, 5.6 * S, 0, 0, TAU); ctx.fill();
      // ala
      ctx.fillStyle = r._shade(color, -30);
      ctx.beginPath();
      ctx.ellipse(lx + A.px * bk * 2 * S, ly + 1 * S, 2.6 * S, 4 * S, flap, 0, TAU);
      ctx.fill();
      // cabeza + pico + ojo
      const hx = lx + A.ux * 6 * S, hy = ly + A.uy * 6 * S;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(hx, hy, 3.4 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(hx, hy, 2.6 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(hx + fx.facing * A.px * 2 * S, hy + fx.facing * A.py * 2 * S);
      ctx.lineTo(hx + fx.facing * A.px * 5.4 * S, hy + fx.facing * A.py * 5.4 * S + 1 * S);
      ctx.lineTo(hx + fx.facing * A.px * 2 * S, hy + fx.facing * A.py * 2 * S + 2.2 * S);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(hx + fx.facing * A.px * 0.8 * S, hy - 0.8 * S, 1 * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(hx + fx.facing * A.px * 0.8 * S, hy - 0.8 * S, 0.5 * S, 0, TAU); ctx.fill();
    }

    r._limbSeg(ctx, p.chest, p.handF, 8.5 * S, COAT);
    fists(ctx, r, p);

    // Cabeza: tricornio, parche, barba trenzada con broches, arito de oro
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.5 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 8));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -30));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // ojos (el de atrás lo tapa el parche)
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11 });
      // parche: correa cruzada + parche sobre el ojo de atrás
      const ex = head.x + fxx * R * 0.34 + A.ux * R * 0.12 - A.ux * R * 0.3 * 0.55 + fxx * R * 0.3 * 0.28;
      const ey = head.y + fyy * R * 0.34 + A.uy * R * 0.12 - A.uy * R * 0.3 * 0.55 + fyy * R * 0.3 * 0.28;
      ctx.strokeStyle = '#241d33';
      ctx.lineWidth = 1.4 * S;
      ctx.beginPath();
      ctx.arc(head.x, head.y, R * 0.92,
              Math.atan2(A.uy, A.ux) + 0.5, Math.atan2(A.uy, A.ux) + 2.6);
      ctx.stroke();
      ctx.fillStyle = '#241d33';
      ctx.beginPath(); ctx.arc(ex, ey, R * 0.3, 0, TAU); ctx.fill();
      // barba TRENZADA: tres mechones con broches dorados
      for (let i = -1; i <= 1; i++) {
        const bx = head.x - A.ux * R * 0.75 + fxx * R * (0.25 + i * 0.02) + A.px * i * 3.4 * S;
        const by = head.y - A.uy * R * 0.75 + fyy * R * (0.25 + i * 0.02) + A.py * i * 3.4 * S;
        const sway = Math.sin(r.t * 3 + i * 2) * 1.4 * S;
        const tx = bx - A.ux * 12 * S + sway, ty = by - A.uy * 12 * S + Math.abs(sway) * 0.4;
        ctx.strokeStyle = r._ink;
        ctx.lineWidth = 4.6 * S;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = BEARD;
        ctx.lineWidth = 3.2 * S;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        // broche dorado al final
        ctx.fillStyle = GOLD;
        ctx.beginPath(); ctx.arc(tx, ty, 1.7 * S, 0, TAU); ctx.fill();
      }
      // bigote
      ctx.strokeStyle = BEARD;
      ctx.lineWidth = 2.2 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.4 - A.ux * R * 0.28, head.y + fyy * R * 0.4 - A.uy * R * 0.28,
              R * 0.24, Math.atan2(fyy, fxx) - 1.6, Math.atan2(fyy, fxx) + 0.6);
      ctx.stroke();
      // arito de oro
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.3 * S;
      ctx.beginPath();
      ctx.arc(head.x - fxx * R * 0.85, head.y - fyy * R * 0.85 + 2 * S, 2.2 * S, 0, TAU);
      ctx.stroke();
      // TRICORNIO: tres picos negros con ribete dorado y pluma del equipo
      const hatA = Math.atan2(A.py, A.px);
      const hat = () => {
        ctx.beginPath();
        ctx.moveTo(head.x + (A.ux * 6 + A.px * 13) * S, head.y + (A.uy * 6 + A.py * 13) * S);
        ctx.quadraticCurveTo(
          head.x + A.ux * 20 * S + fxx * 4 * S, head.y + A.uy * 20 * S + fyy * 4 * S,
          head.x + (A.ux * 15 - A.px * 0) * S + fxx * 2 * S,
          head.y + (A.uy * 15 - A.py * 0) * S + fyy * 2 * S);
        ctx.quadraticCurveTo(
          head.x + A.ux * 20 * S - fxx * 6 * S, head.y + A.uy * 20 * S - fyy * 6 * S,
          head.x + (A.ux * 6 - A.px * 13) * S, head.y + (A.uy * 6 - A.py * 13) * S);
        ctx.quadraticCurveTo(
          head.x + A.ux * 10 * S, head.y + A.uy * 10 * S,
          head.x + (A.ux * 6 + A.px * 13) * S, head.y + (A.uy * 6 + A.py * 13) * S);
        ctx.closePath();
      };
      hat();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 2.8 * S; ctx.lineJoin = 'round'; ctx.stroke();
      hat();
      ctx.fillStyle = '#241f2e';
      ctx.fill();
      // ribete dorado del ala
      ctx.strokeStyle = GOLD;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2 * S;
      ctx.beginPath();
      ctx.moveTo(head.x + (A.ux * 6 + A.px * 12) * S, head.y + (A.uy * 6 + A.py * 12) * S);
      ctx.quadraticCurveTo(
        head.x + A.ux * 11 * S, head.y + A.uy * 11 * S,
        head.x + (A.ux * 6 - A.px * 12) * S, head.y + (A.uy * 6 - A.py * 12) * S);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // pluma del equipo en el tricornio: cañón corto + penacho con barbas,
      // no un alambre — a escala de juego una línea larga parecía antena.
      {
        const sway = Math.sin(r.t * 4) * 1.2 * S;
        const fbx = head.x + (A.ux * 13 - fxx * 8) * S;
        const fby = head.y + (A.uy * 13 - fyy * 8) * S;
        const ftx = head.x + (A.ux * 21 - fxx * 13) * S + sway;
        const fty = head.y + (A.uy * 21 - fyy * 13) * S;
        ctx.strokeStyle = r._ink;
        ctx.lineWidth = 2 * S;
        ctx.beginPath(); ctx.moveTo(fbx, fby); ctx.lineTo(ftx, fty); ctx.stroke();
        // penacho: pluma ancha inclinada hacia atrás
        const fa = Math.atan2(fty - fby, ftx - fbx);
        ctx.save();
        ctx.translate(ftx, fty);
        ctx.rotate(fa);
        ctx.fillStyle = r._ink;
        ctx.beginPath(); ctx.ellipse(3 * S, 0, 7.6 * S, 3.6 * S, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(3 * S, 0, 6.4 * S, 2.7 * S, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = r._shade(color, -42);
        ctx.lineWidth = 0.8 * S;
        ctx.beginPath(); ctx.moveTo(-2 * S, 0); ctx.lineTo(8.5 * S, 0); ctx.stroke();
        ctx.restore();
      }
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════
// SILVANO — El Druida (guardián del bosque)
// Silueta: ASTAS de ciervo + capa de hojas + rama viva florecida como escoba
// + dos mariposas que lo siguen. Sereno, verde, y más rápido de lo que
// aparenta un señor que habla con los árboles.
// ══════════════════════════════════════════════════════════════════════════
const SILVANO = {
  id: 'silvano', nombre: 'Silvano', titulo: 'el Druida', rol: 'Guardián del bosque',
  bio: 'Le pidió permiso al árbol antes de cortar la rama que monta. El ' +
       'árbol dijo que sí. Las mariposas lo siguen porque huele a primavera.',
  palettes: {
    base: { ROBE: '#6b5a3a', LEAF: '#4a7a3a', LEAF2: '#6a9a4a', ANTLER: '#d8cdb0' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { ROBE, LEAF, LEAF2, ANTLER } = this.palettes.base;
    const spd = Math.hypot(b.vel.x, b.vel.y);

    // Mariposas: dos compañeras que orbitan con aleteo. Una del equipo, una
    // blanca. A más velocidad, más lejos quedan (les cuesta seguirlo).
    const drawMariposa = (phase, col) => {
      const a = r.t * 1.4 + phase;
      const dist = (26 + Math.min(spd / 900, 1) * 14) * S;
      const mx = p.chest.x + Math.cos(a) * dist;
      const my = p.chest.y + Math.sin(a) * dist * 0.55 - 8 * S + Math.sin(r.t * 3 + phase) * 4 * S;
      const flap = Math.abs(Math.sin(r.t * 11 + phase));
      ctx.fillStyle = col;
      for (const side of [1, -1]) {
        ctx.beginPath();
        ctx.ellipse(mx + side * 2.2 * S * flap, my, 2.6 * S * flap + 0.6 * S, 1.7 * S,
                    side * 0.6, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#241d33';
      ctx.fillRect(mx - 0.5 * S, my - 1.7 * S, 1 * S, 3.4 * S);
      return Math.sin(a) > 0;
    };
    drawMariposa(0, color);

    // Capa de hojas (la cadena): hojas sueltas girando en vez de tela
    for (let i = 1; i < cape.length; i++) {
      const sz = (5.5 - i * 0.5) * S;
      if (sz <= 1) continue;
      ctx.save();
      ctx.translate(cape[i].x, cape[i].y + Math.sin(r.t * 4 + i * 1.7) * 2.6 * S);
      ctx.rotate(Math.sin(r.t * 2 + i * 2) * 0.7 + i);
      ctx.globalAlpha = 0.9 - i * 0.1;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.ellipse(0, 0, sz + 1 * S, sz * 0.55 + 1 * S, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = i % 2 ? LEAF : LEAF2;
      ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.55, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = r._shade(LEAF, -30);
      ctx.lineWidth = 0.6 * S;
      ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(sz, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 8.5 * S, r._shade(ROBE, -22));
    r._limbSeg(ctx, p.chest, p.handB, 7.5 * S, r._shade(ROBE, -14));

    // Rama viva: torcida, con hojas brotando del palo, cola de ramitas
    // verdes y una FLOR en la punta que respira.
    broomBase(ctx, r, b, {
      wood: '#7a5a34', woodDark: '#4e3a1e', woodLight: '#96744a', w: 6.5, bend: 6,
      bind: '#5a7a3a',
      bristles: (c, x, y, d, nx, ny) => {
        c.strokeStyle = '#5a7a3a';
        c.lineWidth = 2 * S;
        for (let i = -2; i <= 2; i++) {
          const a = b.angle + Math.PI + i * 0.16 + Math.sin(r.t * 1.6 + i) * 0.05;
          const len = (28 - Math.abs(i) * 3) * S;
          const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
          c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
          // hojita en cada punta
          c.fillStyle = i % 2 ? LEAF : LEAF2;
          c.beginPath();
          c.ellipse(ex, ey, 3.4 * S, 1.9 * S, a, 0, TAU);
          c.fill();
        }
      },
      tip: (c, tip, d, nx, ny) => {
        // flor: pétalos alrededor de un centro dorado, "respira"
        const bloom = 1 + Math.sin(r.t * 1.8) * 0.12;
        c.fillStyle = '#e89ab8';
        for (let i = 0; i < 5; i++) {
          const a = r.t * 0.4 + i * (TAU / 5);
          c.beginPath();
          c.ellipse(tip.x + Math.cos(a) * 3.4 * S * bloom, tip.y + Math.sin(a) * 3.4 * S * bloom,
                    3 * S * bloom, 1.9 * S * bloom, a, 0, TAU);
          c.fill();
        }
        c.fillStyle = '#f2d24e';
        c.beginPath(); c.arc(tip.x, tip.y, 2.2 * S * bloom, 0, TAU); c.fill();
      },
    });

    // hojas brotando del palo (dos, fijas al eje)
    {
      const d = b.dir(), nx = -d.y, ny = d.x;
      const tail = b.tail();
      for (const [f, side] of [[0.45, 1], [0.65, -1]]) {
        const lx = tail.x + d.x * 110 * S * f, ly = tail.y + d.y * 110 * S * f;
        ctx.fillStyle = LEAF2;
        ctx.beginPath();
        ctx.ellipse(lx + nx * side * 4 * S, ly + ny * side * 4 * S, 4.2 * S, 2.2 * S,
                    Math.atan2(ny, nx) + side * 0.5, 0, TAU);
        ctx.fill();
      }
    }

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 9 * S, r._shade(ROBE, -8));

    // Túnica de corteza + CAPA DE HOJAS en capas escalonadas sobre los hombros
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 10.5 * S, HW_H = 15 * S;
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1), h1 = at(0, -1, 2 * S), h2 = at(0, 1, 2 * S);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(h1.x, h1.y);
        ctx.lineTo(h2.x, h2.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, r._shade(ROBE, 16));
      g.addColorStop(1, r._shade(ROBE, -26));
      path(); ctx.fillStyle = g; ctx.fill();
      // vetas de corteza
      ctx.strokeStyle = r._shade(ROBE, -36);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1 * S;
      for (const s2 of [-0.4, 0.15, 0.6]) {
        ctx.beginPath();
        ctx.moveTo(at(0.1, s2).x, at(0.1, s2).y);
        ctx.quadraticCurveTo(at(0.5, s2 * 1.2).x, at(0.5, s2 * 1.2).y,
                             at(0.9, s2 * 0.8).x, at(0.9, s2 * 0.8).y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // esclavina de hojas: dos filas de festones sobre hombros/pecho
      for (const [f, n, sz] of [[0.92, 4, 6], [0.78, 3, 5]]) {
        for (let i = 0; i < n; i++) {
          const side = (i / (n - 1)) * 2 - 1;
          const lx = lerp(p.pelvis.x, p.chest.x, f) + A.px * side * HW_C * 0.85;
          const ly = lerp(p.pelvis.y, p.chest.y, f) + A.py * side * HW_C * 0.85;
          ctx.fillStyle = r._ink;
          ctx.beginPath();
          ctx.ellipse(lx, ly, (sz + 1) * S, (sz + 1) * 0.65 * S,
                      Math.atan2(A.py, A.px) + side * 0.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = i % 2 ? LEAF : LEAF2;
          ctx.beginPath();
          ctx.ellipse(lx, ly, sz * S, sz * 0.65 * S,
                      Math.atan2(A.py, A.px) + side * 0.4, 0, TAU);
          ctx.fill();
        }
      }
      // colgante de madera: espiral
      const px2 = lerp(p.pelvis.x, p.chest.x, 0.6), py2 = lerp(p.pelvis.y, p.chest.y, 0.6);
      ctx.strokeStyle = '#3a2c18';
      ctx.lineWidth = 1.3 * S;
      ctx.beginPath();
      for (let a = 0; a < TAU * 1.8; a += 0.4) {
        const rr = 1 + a * 0.55;
        const X = px2 + Math.cos(a) * rr * S * 0.55, Y = py2 + Math.sin(a) * rr * S * 0.55;
        a === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }

    r._limbSeg(ctx, p.chest, p.handF, 8 * S, ROBE);
    fists(ctx, r, p);

    // Cabeza: ASTAS ramificadas, corona de hojas, barba corta con una hojita
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      // astas primero (detrás de la cabeza)
      const asta = (side) => {
        const bx = head.x + A.px * side * R * 0.6 + A.ux * R * 0.7;
        const by = head.y + A.py * side * R * 0.6 + A.uy * R * 0.7;
        ctx.strokeStyle = r._ink;
        ctx.lineWidth = 4.4 * S;
        ctx.lineCap = 'round';
        const seg = (x1, y1, x2, y2, w) => {
          ctx.lineWidth = w + 1.8 * S;
          ctx.strokeStyle = r._ink;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.lineWidth = w;
          ctx.strokeStyle = ANTLER;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        };
        const m1x = bx + A.px * side * 7 * S + A.ux * 9 * S;
        const m1y = by + A.py * side * 7 * S + A.uy * 9 * S;
        const t1x = m1x + A.px * side * 4 * S + A.ux * 9 * S;
        const t1y = m1y + A.py * side * 4 * S + A.uy * 9 * S;
        seg(bx, by, m1x, m1y, 3.2 * S);
        seg(m1x, m1y, t1x, t1y, 2.4 * S);
        // púas
        seg(m1x, m1y, m1x + A.px * side * 7 * S + A.ux * 2 * S,
            m1y + A.py * side * 7 * S + A.uy * 2 * S, 2 * S);
        seg((bx + m1x) / 2, (by + m1y) / 2,
            (bx + m1x) / 2 - A.px * side * 1 * S + A.ux * 6.5 * S,
            (by + m1y) / 2 - A.py * side * 1 * S + A.uy * 6.5 * S, 2 * S);
      };
      asta(1); asta(-1);
      // cabeza
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.4 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 12));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -24));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // corona de hojas en la frente
      for (let i = -1; i <= 1; i++) {
        const lx = head.x + A.ux * R * 0.75 + A.px * i * 5 * S;
        const ly = head.y + A.uy * R * 0.75 + A.py * i * 5 * S;
        ctx.fillStyle = i === 0 ? LEAF2 : LEAF;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 4 * S, 2.2 * S, Math.atan2(A.py, A.px) + i * 0.4, 0, TAU);
        ctx.fill();
      }
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11, irisA: '#4a7a3a' });
      // barba corta canosa con una hojita enredada
      ctx.fillStyle = '#c8c0aa';
      ctx.beginPath();
      ctx.arc(head.x - A.ux * R * 0.8 + fxx * R * 0.2,
              head.y - A.uy * R * 0.8 + fyy * R * 0.2, R * 0.42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = LEAF2;
      ctx.beginPath();
      ctx.ellipse(head.x - A.ux * R * 1.02 + fxx * R * 0.35,
                  head.y - A.uy * R * 1.02 + fyy * R * 0.35, 2.6 * S, 1.4 * S, 0.6, 0, TAU);
      ctx.fill();
      // sonrisa serena
      ctx.strokeStyle = '#8a6a52';
      ctx.lineWidth = 1.2 * S;
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.4 - A.ux * R * 0.3, head.y + fyy * R * 0.4 - A.uy * R * 0.3,
              R * 0.2, Math.atan2(fyy, fxx) - 0.4, Math.atan2(fyy, fxx) + 0.8);
      ctx.stroke();
    }

    drawMariposa(Math.PI, '#f2ecdd');
  },
};

// ══════════════════════════════════════════════════════════════════════════
// FOGÓN — El Cocinero (chef de combate)
// Silueta: gorro de chef GIGANTE + bigotazo + panza + cucharón con cola de
// batidor. Vapor en vez de capa. El pañuelo del cuello marca el equipo.
// Cada gol es una receta y vos sos el ingrediente.
// ══════════════════════════════════════════════════════════════════════════
const FOGON = {
  id: 'fogon', nombre: 'Fogón', titulo: 'el Cocinero', rol: 'Chef de combate',
  bio: 'Expulsado de la cocina real por condimentar de más. Para él cada ' +
       'gol es una receta: los ingredientes son la pelota, el arco y vos.',
  palettes: {
    base: { WHITES: '#f0ede4', WHITES_D: '#cfc8b8', APRON: '#8a4a3a', STACHE: '#4a3020' },
  },
  draw(ctx, r, player, color, dark, world, fx) {
    const p = player.rider.points, b = player.broom, cape = player.rider.cape;
    const { WHITES, WHITES_D, APRON, STACHE } = this.palettes.base;
    const boost = b.boostPower || 0;

    // Vapor: nubes blancas que suben y se disipan (la cadena de la capa).
    // Cocina en movimiento — con impulso, hierve.
    for (let i = 1; i < cape.length; i++) {
      const rad = (7 - i * 0.7) * S * (1 + boost * 0.4);
      if (rad <= 1) continue;
      ctx.globalAlpha = (0.42 - i * 0.05) * (0.7 + boost * 0.5);
      ctx.fillStyle = '#f2f0e8';
      ctx.beginPath();
      ctx.arc(cape[i].x + Math.sin(r.t * 3 + i * 2) * 3 * S,
              cape[i].y - i * 2.4 * S + Math.sin(r.t * 2 + i) * 2 * S, rad, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    r._limb(ctx, p.pelvis, p.kneeB, p.footB, 9.5 * S, '#3a3448');
    r._limbSeg(ctx, p.chest, p.handB, 9 * S, WHITES_D);

    // Cucharón de madera con cola de BATIDOR de alambre
    broomBase(ctx, r, b, {
      wood: '#a8763e', woodDark: '#6b4423', w: 6,
      bind: '#8a8a96',
      bristles: (c, x, y, d, nx, ny) => {
        // batidor: alambres en jaula
        c.strokeStyle = '#b8bfca';
        c.lineWidth = 1.6 * S;
        for (const k of [1, 0.62, 0.3]) {
          c.beginPath();
          c.ellipse(x - d.x * 13 * S, y - d.y * 13 * S,
                    13 * S, 8 * S * k, Math.atan2(d.y, d.x), 0, TAU);
          c.stroke();
        }
      },
      tip: (c, tip, d, nx, ny) => {
        // cabeza de cucharón: cuenco visto de perfil
        c.fillStyle = r._ink;
        c.beginPath();
        c.ellipse(tip.x + d.x * 4 * S, tip.y + d.y * 4 * S, 8.6 * S, 6 * S,
                  Math.atan2(d.y, d.x), 0, TAU);
        c.fill();
        c.fillStyle = '#a8763e';
        c.beginPath();
        c.ellipse(tip.x + d.x * 4 * S, tip.y + d.y * 4 * S, 7.4 * S, 4.8 * S,
                  Math.atan2(d.y, d.x), 0, TAU);
        c.fill();
        c.fillStyle = '#6b4423';
        c.beginPath();
        c.ellipse(tip.x + d.x * 5 * S, tip.y + d.y * 5 * S, 4.6 * S, 2.6 * S,
                  Math.atan2(d.y, d.x), 0, TAU);
        c.fill();
      },
    });

    r._limb(ctx, p.pelvis, p.kneeF, p.footF, 10 * S, '#464058');

    // Chaqueta de chef con panza, doble botonadura, delantal manchado y
    // PAÑUELO del equipo al cuello.
    {
      const A = axis(p.pelvis, p.chest);
      const HW_C = 11 * S, HW_H = 17 * S;   // panza generosa
      const at = (f, side, extra = 0) => ({
        x: lerp(p.pelvis.x, p.chest.x, f) + A.px * (lerp(HW_H, HW_C, f) + extra) * side,
        y: lerp(p.pelvis.y, p.chest.y, f) + A.py * (lerp(HW_H, HW_C, f) + extra) * side,
      });
      const path = () => {
        const c1 = at(1, 1), c2 = at(1, -1);
        const h1 = at(0, -1, 2 * S), h2 = at(0, 1, 2 * S);
        const mid = { x: lerp(h1.x, h2.x, 0.5) - A.ux * 4 * S, y: lerp(h1.y, h2.y, 0.5) - A.uy * 4 * S };
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
        // panza redonda del lado del frente
        ctx.quadraticCurveTo(
          at(0.4, -1, 4 * S).x, at(0.4, -1, 4 * S).y, h1.x, h1.y);
        ctx.quadraticCurveTo(mid.x, mid.y, h2.x, h2.y);
        ctx.quadraticCurveTo(at(0.4, 1, 4 * S).x, at(0.4, 1, 4 * S).y, c1.x, c1.y);
        ctx.closePath();
      };
      path();
      ctx.strokeStyle = r._ink; ctx.lineWidth = 3.2 * S; ctx.lineJoin = 'round'; ctx.stroke();
      const g = ctx.createLinearGradient(
        p.chest.x + A.px * HW_C, p.chest.y + A.py * HW_C,
        p.chest.x - A.px * HW_C, p.chest.y - A.py * HW_C);
      g.addColorStop(0, WHITES);
      g.addColorStop(1, WHITES_D);
      path(); ctx.fillStyle = g; ctx.fill();
      // delantal: panel oscuro al frente con manchas de salsa
      const ap = () => {
        ctx.beginPath();
        ctx.moveTo(at(0.55, fx.facing * 0.75).x, at(0.55, fx.facing * 0.75).y);
        ctx.lineTo(at(0.55, fx.facing * 0.1).x, at(0.55, fx.facing * 0.1).y);
        ctx.lineTo(at(0.02, fx.facing * 0.15).x, at(0.02, fx.facing * 0.15).y);
        ctx.lineTo(at(0.02, fx.facing * 1).x, at(0.02, fx.facing * 1).y);
        ctx.closePath();
      };
      ap();
      ctx.fillStyle = APRON;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      // manchas de salsa (¡y una del color del equipo!)
      for (const [f, s2, sz, col] of [[0.34, 0.55, 2.6, '#c8452e'],
                                      [0.18, 0.35, 1.8, '#e8a02e'],
                                      [0.26, 0.8, 1.5, color]]) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(at(f, fx.facing * s2).x, at(f, fx.facing * s2).y, sz * S, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // botones de la chaqueta (lado de atrás, doble fila)
      ctx.fillStyle = WHITES_D;
      for (const f of [0.45, 0.62, 0.79]) {
        ctx.beginPath();
        ctx.arc(at(f, -fx.facing * 0.5).x, at(f, -fx.facing * 0.5).y, 1.5 * S, 0, TAU);
        ctx.fill();
      }
      // PAÑUELO del equipo anudado al cuello
      const n1 = at(0.97, 0.7), n2 = at(0.97, -0.7);
      ctx.strokeStyle = r._ink; ctx.lineWidth = 6 * S;
      ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 4.4 * S;
      ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.stroke();
      // puntas del nudo cayendo
      const kx = at(0.92, fx.facing * 0.8).x, ky = at(0.92, fx.facing * 0.8).y;
      ctx.fillStyle = color;
      for (const off of [0, 1]) {
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(kx + fx.facing * A.px * (4 + off * 3) * S - A.ux * (7 + off * 2) * S,
                   ky + fx.facing * A.py * (4 + off * 3) * S - A.uy * (7 + off * 2) * S);
        ctx.lineTo(kx + fx.facing * A.px * (1 + off * 3) * S - A.ux * (4 + off * 2) * S,
                   ky + fx.facing * A.py * (1 + off * 3) * S - A.uy * (4 + off * 2) * S);
        ctx.closePath(); ctx.fill();
      }
    }

    r._limbSeg(ctx, p.chest, p.handF, 9.5 * S, WHITES);
    fists(ctx, r, p);

    // Cabeza: GORRO DE CHEF gigante con pliegues, bigotazo enrulado, cejas
    // gruesas, nariz rosada — el gorro se ladea con la velocidad.
    {
      const head = p.head, chest = p.chest;
      const A = axis(chest, head);
      const R = 11 * S;
      const fxx = A.px * fx.facing, fyy = A.py * fx.facing;
      ctx.fillStyle = r._ink;
      ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.5 * S, 0, TAU); ctx.fill();
      const gf = ctx.createLinearGradient(
        head.x + A.ux * R, head.y + A.uy * R,
        head.x - A.ux * R, head.y - A.uy * R);
      gf.addColorStop(0, r._shade(CFG.colors.skin, 20));
      gf.addColorStop(1, r._shade(CFG.colors.skin, -18));
      ctx.fillStyle = gf;
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, TAU); ctx.fill();
      // cejas gruesas
      ctx.strokeStyle = STACHE;
      ctx.lineWidth = 2.4 * S;
      ctx.lineCap = 'round';
      const eb = { x: head.x + fxx * R * 0.34 + A.ux * R * 0.12,
                   y: head.y + fyy * R * 0.34 + A.uy * R * 0.12 };
      const sep = R * 0.30;
      for (const sgn of [0.55, -0.55]) {
        const ex = eb.x + A.ux * sep * sgn + fxx * sep * 0.28;
        const ey = eb.y + A.uy * sep * sgn + fyy * sep * 0.28;
        ctx.beginPath();
        ctx.moveTo(ex - fxx * R * 0.16 + A.ux * R * 0.26, ey - fyy * R * 0.16 + A.uy * R * 0.26);
        ctx.lineTo(ex + fxx * R * 0.2 + A.ux * R * 0.28, ey + fyy * R * 0.2 + A.uy * R * 0.28);
        ctx.stroke();
      }
      eyes(ctx, r, head, A.ux, A.uy, fx, { R: 11 });
      // nariz rosada grande
      ctx.fillStyle = '#d88a72';
      ctx.beginPath();
      ctx.arc(head.x + fxx * R * 0.58 - A.ux * R * 0.05,
              head.y + fyy * R * 0.58 - A.uy * R * 0.05, R * 0.2, 0, TAU);
      ctx.fill();
      // BIGOTAZO: dos rulos hacia arriba
      ctx.strokeStyle = r._ink;
      ctx.lineWidth = 4.4 * S;
      for (const side of [1, -1]) {
        ctx.beginPath();
        ctx.arc(head.x + fxx * R * 0.42 - A.ux * R * 0.24 + A.px * side * R * 0.32,
                head.y + fyy * R * 0.42 - A.uy * R * 0.24 + A.py * side * R * 0.32,
                R * 0.3, Math.atan2(fyy, fxx) - side * 0.4, Math.atan2(fyy, fxx) + side * 2.6, side < 0);
        ctx.stroke();
      }
      ctx.strokeStyle = STACHE;
      ctx.lineWidth = 3.2 * S;
      for (const side of [1, -1]) {
        ctx.beginPath();
        ctx.arc(head.x + fxx * R * 0.42 - A.ux * R * 0.24 + A.px * side * R * 0.32,
                head.y + fyy * R * 0.42 - A.uy * R * 0.24 + A.py * side * R * 0.32,
                R * 0.3, Math.atan2(fyy, fxx) - side * 0.4, Math.atan2(fyy, fxx) + side * 2.6, side < 0);
        ctx.stroke();
      }
      // GORRO: banda + globo plisado enorme, ladeado según velocidad
      const lean = clamp((fx.look?.x ?? 0) / 900, -1, 1) * -4 * S;
      const bandY = 0.72;
      ctx.strokeStyle = r._ink;
      ctx.lineWidth = 7.4 * S;
      ctx.beginPath();
      ctx.moveTo(head.x + A.ux * R * bandY + A.px * R * 0.95, head.y + A.uy * R * bandY + A.py * R * 0.95);
      ctx.lineTo(head.x + A.ux * R * bandY - A.px * R * 0.95, head.y + A.uy * R * bandY - A.py * R * 0.95);
      ctx.stroke();
      ctx.strokeStyle = WHITES;
      ctx.lineWidth = 6 * S;
      ctx.beginPath();
      ctx.moveTo(head.x + A.ux * R * bandY + A.px * R * 0.95, head.y + A.uy * R * bandY + A.py * R * 0.95);
      ctx.lineTo(head.x + A.ux * R * bandY - A.px * R * 0.95, head.y + A.uy * R * bandY - A.py * R * 0.95);
      ctx.stroke();
      // globo del gorro: tres lóbulos plisados
      const topX = head.x + A.ux * R * 2.15 + A.px * lean;
      const topY = head.y + A.uy * R * 2.15 + A.py * lean;
      const puff = (ox, oy, rr) => {
        ctx.fillStyle = r._ink;
        ctx.beginPath(); ctx.arc(ox, oy, rr + 1.4 * S, 0, TAU); ctx.fill();
      };
      const puff2 = (ox, oy, rr, col) => {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(ox, oy, rr, 0, TAU); ctx.fill();
      };
      const l1 = { x: topX + A.px * R * 0.55, y: topY + A.py * R * 0.55 };
      const l2 = { x: topX - A.px * R * 0.55, y: topY - A.py * R * 0.55 };
      const l3 = { x: topX + A.ux * R * 0.3, y: topY + A.uy * R * 0.3 };
      puff(l1.x, l1.y, R * 0.62); puff(l2.x, l2.y, R * 0.62); puff(l3.x, l3.y, R * 0.72);
      puff2(l1.x, l1.y, R * 0.62, WHITES_D);
      puff2(l2.x, l2.y, R * 0.62, WHITES_D);
      puff2(l3.x, l3.y, R * 0.72, WHITES);
      // pliegues
      ctx.strokeStyle = WHITES_D;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.1 * S;
      for (const s2 of [-0.45, 0, 0.45]) {
        ctx.beginPath();
        ctx.moveTo(head.x + A.ux * R * (bandY + 0.15) + A.px * s2 * R * 0.8,
                   head.y + A.uy * R * (bandY + 0.15) + A.py * s2 * R * 0.8);
        ctx.lineTo(topX + A.px * s2 * R * 0.5, topY + A.py * s2 * R * 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  },
};

// Tabla id → estela. La usa main.js; si un personaje no está acá, cae en la
// mágica clásica, así sumar un skin nuevo nunca rompe el partido.
export const TRAILS = {
  mago:    trailMago,
  valka:   trailValka,
  mordrak: trailMordrak,
  izar:    trailIzar,
  zefir:   trailZefir,
};

// Emite la estela del personaje indicado (o la clásica si no tiene una).
export function emitTrail(id, particles, x, y, dirX, dirY, power, boost, color) {
  (TRAILS[id] || trailMago)(particles, x, y, dirX, dirY, power, boost, color);
}

export const CHARACTERS = {
  valka: VALKA,
  mordrak: MORDRAK,
  izar: IZAR,
  zefir: ZEFIR,
  petra: PETRA,
  hilaria: HILARIA,
  vendaval: VENDAVAL,
  silvano: SILVANO,
  fogon: FOGON,
};

// Plantel completo para la galería (el mago clásico se dibuja en render.js,
// por eso va como builtin sin función propia).
export const ROSTER = [
  {
    id: 'mago', nombre: 'Aldus', titulo: 'el Errante', rol: 'Mago clásico',
    bio: 'El primero en subirse a una escoba y el último en bajarse. ' +
         'Equilibrado en todo, brillante en nada — salvo en ganar.',
    builtin: true,
  },
  VALKA, MORDRAK, IZAR, ZEFIR,
  PETRA, HILARIA, VENDAVAL, SILVANO, FOGON,
];
