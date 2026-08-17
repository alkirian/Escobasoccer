// Arena cerrada: el campo es la imagen del mapa. Los límites (L/R/T/B) están
// calibrados sobre ella: los muros laterales caen en el plano de los arcos
// rúnicos y el suelo sobre el césped. Nada sale del mapa: todo rebota.
import { CFG } from './config.js';

export function portalCenter(side) {
  // side: -1 = arco izquierdo, +1 = arco derecho
  const A = CFG.arena;
  return { x: side < 0 ? A.L : A.R, y: A.portalY };
}

// Succión mágica del portal: cerca de la boca, el vórtice atrae la pelota.
// Suave — un defensor activo puede sacarla, pero acelera el ritmo de goles.
export function applyPortalSuction(ball, dt) {
  const { portalR } = CFG.arena;
  for (const side of [-1, 1]) {
    const c = portalCenter(side);
    const dx = c.x - ball.pos.x, dy = c.y - ball.pos.y;
    const d = Math.hypot(dx, dy);
    const range = portalR * 1.3;
    if (d > range || Math.abs(ball.pos.y - c.y) > portalR * 0.9) continue;
    const t = 1 - d / range;
    const pull = CFG.arena.suction * t * t;
    ball.vel.x += (dx / (d || 1)) * pull * dt;
    ball.vel.y += (dy / (d || 1)) * pull * dt;
  }
}

// Pelota vs arena. Devuelve 'goalL' | 'goalR' | null. onBounce(x,y,fuerza)
export function collideBallArena(ball, onBounce) {
  const { L, R, T, B, portalY, portalR } = CFG.arena;
  const b = CFG.ball.bounce;
  const r = ball.r;

  // ¿Está a la altura del arco? → entra en vez de rebotar
  const inPortalBand = Math.abs(ball.pos.y - portalY) < portalR - r * 0.35;

  if (ball.pos.x - r < L) {
    if (inPortalBand) return 'goalL';
    ball.pos.x = L + r;
    if (ball.vel.x < 0) { onBounce?.(L, ball.pos.y, Math.abs(ball.vel.x)); ball.vel.x = -ball.vel.x * b; }
  } else if (ball.pos.x + r > R) {
    if (inPortalBand) return 'goalR';
    ball.pos.x = R - r;
    if (ball.vel.x > 0) { onBounce?.(R, ball.pos.y, Math.abs(ball.vel.x)); ball.vel.x = -ball.vel.x * b; }
  }

  if (ball.pos.y - r < T) {
    ball.pos.y = T + r;
    if (ball.vel.y < 0) { onBounce?.(ball.pos.x, T, Math.abs(ball.vel.y)); ball.vel.y = -ball.vel.y * b; }
  } else if (ball.pos.y + r > B) {
    ball.pos.y = B - r;
    if (ball.vel.y > 0) { onBounce?.(ball.pos.x, B, Math.abs(ball.vel.y)); ball.vel.y = -ball.vel.y * b; ball.vel.x *= 0.985; }
  }
  return null;
}

// Escoba vs arena: las dos puntas rebotan.
// Además detecta el choque frontal fuerte que deja la escoba clavada:
// tiene que ser LA PUNTA, rápido y bastante de frente. Los roces y los
// golpes de costado nunca clavan — si no, sería un castigo constante.
export function collideBroomArena(broom, onBounce, onImpale) {
  const { L, R, T, B } = CFG.arena;
  const r = CFG.broom.tipR;
  const bn = CFG.broom.bounce;
  const S = CFG.stuck;
  if (broom.stuck) return;
  const ends = [{ p: broom.tip(), isTip: true }, { p: broom.tail(), isTip: false }];
  for (const { p: end, isTip } of ends) {
    let nx = 0, ny = 0, pen = 0;
    if (end.x - r < L) { nx = 1; pen = L - (end.x - r); }
    else if (end.x + r > R) { nx = -1; pen = (end.x + r) - R; }
    if (end.y - r < T) { ny = 1; pen = Math.max(pen, T - (end.y - r)); }
    else if (end.y + r > B) { ny = -1; pen = Math.max(pen, (end.y + r) - B); }
    if (nx === 0 && ny === 0) continue;

    // separar
    broom.pos.x += nx * pen;
    broom.pos.y += ny * pen;
    // impulso de rebote en el punto
    const v = broom.velAt(end.x, end.y);
    const vn = v.x * nx + v.y * ny;

    // ¿Clavada? Punta primero, rápido y de frente contra la superficie.
    if (isTip && onImpale && broom.stuckCd <= 0 && vn < 0) {
      const speed = Math.hypot(v.x, v.y);
      const d = broom.dir();
      const align = -(d.x * nx + d.y * ny); // 1 = perpendicular a la pared
      if (speed >= S.minSpeed && align >= S.minAlign) {
        broom.impale(nx, ny);
        onImpale(end.x, end.y, nx, ny, speed);
        return;
      }
    }

    if (vn < 0) {
      const j = -vn * (1 + bn) * 0.5;
      broom.applyImpulseAt(end.x, end.y, nx * j, ny * j);
      // fricción tangencial leve
      broom.vel.x *= 0.995; broom.vel.y *= 0.995;
      onBounce?.(end.x, end.y, Math.abs(vn));
    }
  }
}

// Punto del ragdoll vs arena (con fricción)
export function clampPointArena(p) {
  const { L, R, T, B } = CFG.arena;
  const r = p.r || 6;
  if (p.y + r > B) { // suelo
    p.y = B - r;
    p.py = p.y + (p.y - p.py) * 0.4;   // rebote amortiguado
    p.px = p.x - (p.x - p.px) * 0.55;  // fricción
  }
  if (p.y - r < T) { p.y = T + r; p.py = p.y + (p.y - p.py) * 0.4; }
  if (p.x - r < L) { p.x = L + r; p.px = p.x + (p.x - p.px) * 0.4; }
  if (p.x + r > R) { p.x = R - r; p.px = p.x + (p.x - p.px) * 0.4; }
}
