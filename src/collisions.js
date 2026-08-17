// Interacciones físicas: cuerpo↔pelota, escoba↔pelota, jugador↔jugador.
// No hay botón de patear: todos los golpes surgen del contacto físico.
import { CFG } from './config.js';
import { closestOnSegment, clamp, lerp } from './utils.js';
import { clampPointArena } from './arena.js';

const FEET = new Set(['footF', 'footB', 'kneeF', 'kneeB']);

// 0 = toque suave (casi absorbe, favorece control) → 1 = impacto pleno
// (rebote enérgico, como ahora). Un toque suave con la pelota quieta
// no debería salir disparada para cualquier lado.
function contactBlend(vn) {
  const B = CFG.ball;
  return clamp((-vn - B.softVn) / (B.hardVn - B.softVn), 0, 1);
}

// Golpe dirigido: durante un latigazo apuntado, el contacto manda la pelota
// hacia el cursor en vez de dejarla salir por donde caiga la tangente. El
// swing sigue siendo física real (el cuerpo gira y llega solo); esto define
// a dónde va la pelota, que es lo que el jugador pidió con el mouse.
function applyAimedHit(rider, ball, contactSpeed) {
  const W = CFG.whip;
  const d = rider.aimDir;
  // La dirección se mezcla ya normalizada, no sobre la velocidad cruda: si no,
  // un impacto muy fuerte arrastra el resultado y la pelota sale torcida.
  const cur = Math.hypot(ball.vel.x, ball.vel.y);
  let ux = d.x, uy = d.y;
  if (cur > 1) {
    ux = lerp(ball.vel.x / cur, d.x, W.aimAssist);
    uy = lerp(ball.vel.y / cur, d.y, W.aimAssist);
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
  }
  // Magnitud acotada al tope de la pelota: sin picos que luego se recortan.
  let speed = Math.max(W.aimedMinPower, Math.min(contactSpeed * 1.15, W.aimedPower));
  speed = Math.min(speed, CFG.ball.maxSpeed);
  ball.vel.x = ux * speed;
  ball.vel.y = uy * speed;
  rider.notifyAimedContact(); // conectó: termina la persecución
}

const aimedNow = (rider) => rider.phase === 'whip' && rider.aimed && rider.aimDir;

// --- Jugador vs pelota ---
export function interactPlayerBall(player, ball, dt, fx) {
  const B = CFG.ball;
  const aimed = aimedNow(player.rider);

  // 1) Puntos del cuerpo (cabeza, torso, piernas, pies)
  for (const { name, p } of player.rider.hitPoints()) {
    const dx = ball.pos.x - p.x, dy = ball.pos.y - p.y;
    const rsum = ball.r + p.r;
    const d = Math.hypot(dx, dy);
    if (d >= rsum || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    const overlap = rsum - d;

    // separar: pelota 70%, punto 30% (el cuerpo absorbe)
    ball.pos.x += nx * overlap * 0.7;
    ball.pos.y += ny * overlap * 0.7;
    p.x -= nx * overlap * 0.3;
    p.y -= ny * overlap * 0.3;

    // impulso por velocidad relativa
    const pv = player.rider.pointVel(p, dt);
    const rvx = ball.vel.x - pv.x, rvy = ball.vel.y - pv.y;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const t = contactBlend(vn);
      const kickMul = FEET.has(name) ? B.feetKick : B.bodyKick;
      const e = lerp(0.1, 0.58, t);
      const kick = lerp(0.4, 1, t) * kickMul;
      const j = -vn * (1 + e) * kick;
      ball.vel.x += nx * j;
      ball.vel.y += ny * j;
      // Toque suave: la pelota también hereda velocidad tangencial del
      // punto → "acompaña" el movimiento en vez de resbalar impredecible.
      if (t < 0.6 && !aimed) {
        const carry = (1 - t) * 0.22;
        ball.vel.x += (pv.x - ball.vel.x) * carry;
        ball.vel.y += (pv.y - ball.vel.y) * carry;
      }
      if (aimed) applyAimedHit(player.rider, ball, Math.hypot(pv.x, pv.y));
      fx?.onImpact(ball.pos.x - nx * ball.r, ball.pos.y - ny * ball.r, Math.abs(vn), 'ball');
    }
  }

  // 2) La escoba como cápsula. Solo la PUNTA pega ("broom shot"): el resto
  // del palo empuja para que la pelota no lo atraviese, pero sin rebote.
  // Si todo el palo golpeara, barrería un círculo mayor que las piernas y le
  // robaría todos los contactos al cuerpo, que es el arma fuerte.
  const tip = player.broom.tip(), tail = player.broom.tail();
  const c = closestOnSegment(ball.pos.x, ball.pos.y, tail.x, tail.y, tip.x, tip.y);
  const onTip = c.t >= B.tipZone; // t = 0 en la cola, 1 en la punta
  const dx = ball.pos.x - c.x, dy = ball.pos.y - c.y;
  const rsum = ball.r + 7;
  const d = Math.hypot(dx, dy);
  if (d < rsum && d > 0) {
    const nx = dx / d, ny = dy / d;
    ball.pos.x += nx * (rsum - d);
    ball.pos.y += ny * (rsum - d);
    const bv = player.broom.velAt(c.x, c.y);
    const rvx = ball.vel.x - bv.x, rvy = ball.vel.y - bv.y;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const t = contactBlend(vn);
      const e = onTip ? lerp(0.15, 0.6, t) : 0.05;
      const kick = onTip ? lerp(0.4, 1, t) * B.broomKick : B.shaftKick;
      const j = -vn * (1 + e) * kick;
      ball.vel.x += nx * j;
      ball.vel.y += ny * j;
      // El palo arrastra la pelota en vez de rebotarla: sirve para conducir.
      const carry = onTip ? (t < 0.6 ? (1 - t) * 0.18 : 0) : 0.14;
      if (carry > 0 && !aimed) {
        ball.vel.x += (bv.x - ball.vel.x) * carry;
        ball.vel.y += (bv.y - ball.vel.y) * carry;
      }
      // En un golpe dirigido también vale la escoba: lo que importa es que
      // salga hacia el cursor, no con qué parte se conectó.
      if (aimed) applyAimedHit(player.rider, ball, Math.hypot(bv.x, bv.y));
      // retroceso leve en la escoba
      player.broom.applyImpulseAt(c.x, c.y, -nx * j * 0.12, -ny * j * 0.12);
      if (onTip || aimed) fx?.onImpact(c.x, c.y, Math.abs(vn), 'broom');
    }
  }
}

// --- Jugador vs jugador: embestidas, empujones, enganches temporales ---
export function interactPlayers(pa, pb, dt, fx) {
  const ptsA = pa.rider.hitPoints(), ptsB = pb.rider.hitPoints();

  // cuerpos entre sí (separación posicional → el verlet crea el caos)
  for (const { p: a } of ptsA) {
    for (const { p: b } of ptsB) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const rsum = a.r + b.r + 2;
      const d = Math.hypot(dx, dy);
      if (d >= rsum || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      const push = (rsum - d) * 0.5;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }

  // escoba de A contra cuerpo de B (y viceversa) → embestidas
  broomVsBody(pa, ptsB, pb, dt, fx);
  broomVsBody(pb, ptsA, pa, dt, fx);

  // escoba vs escoba: choque de palos
  broomVsBroom(pa, pb, fx);
}

function broomVsBody(attacker, points, victim, dt, fx) {
  const tip = attacker.broom.tip(), tail = attacker.broom.tail();
  for (const { p } of points) {
    const c = closestOnSegment(p.x, p.y, tail.x, tail.y, tip.x, tip.y);
    const dx = p.x - c.x, dy = p.y - c.y;
    const rsum = p.r + 7;
    const d = Math.hypot(dx, dy);
    if (d >= rsum || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    // empujar el punto del cuerpo
    p.x += nx * (rsum - d) * 0.85;
    p.y += ny * (rsum - d) * 0.85;

    const bv = attacker.broom.velAt(c.x, c.y);
    const pv = victim.rider.pointVel(p, dt);
    const rvn = (bv.x - pv.x) * nx + (bv.y - pv.y) * ny;
    if (rvn > 120) {
      // embestida: transmitir velocidad al cuerpo (vía prev) y a la escoba rival
      p.px = p.x - (pv.x + nx * rvn * 0.8) * dt;
      p.py = p.y - (pv.y + ny * rvn * 0.8) * dt;
      victim.broom.applyImpulseAt(p.x, p.y, nx * rvn * 0.25, ny * rvn * 0.25);
      // la embestida cuesta velocidad al atacante (riesgo/recompensa)
      attacker.broom.applyImpulseAt(c.x, c.y, -nx * rvn * 0.18, -ny * rvn * 0.18);
      fx?.onImpact(c.x, c.y, rvn, 'ram');
    }
  }
}

function broomVsBroom(pa, pb, fx) {
  const A = pa.broom, Bb = pb.broom;
  const aPts = [A.tail(), A.pos, A.tip()];
  const tipB = Bb.tip(), tailB = Bb.tail();
  for (const q of aPts) {
    const c = closestOnSegment(q.x, q.y, tailB.x, tailB.y, tipB.x, tipB.y);
    const dx = q.x - c.x, dy = q.y - c.y;
    const rsum = 12;
    const d = Math.hypot(dx, dy);
    if (d >= rsum || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    const va = A.velAt(q.x, q.y), vb = Bb.velAt(c.x, c.y);
    const vn = (va.x - vb.x) * nx + (va.y - vb.y) * ny;
    // separar
    A.pos.x += nx * (rsum - d) * 0.4; A.pos.y += ny * (rsum - d) * 0.4;
    Bb.pos.x -= nx * (rsum - d) * 0.4; Bb.pos.y -= ny * (rsum - d) * 0.4;
    if (vn < 0) {
      const j = -vn * 0.55;
      A.applyImpulseAt(q.x, q.y, nx * j, ny * j);
      Bb.applyImpulseAt(c.x, c.y, -nx * j, -ny * j);
      if (-vn > 150) fx?.onImpact(c.x, c.y, -vn, 'clack');
    }
  }
}

// Mantener los cuerpos dentro de la arena
export function clampRiderArena(player) {
  for (const { p } of player.rider.hitPoints()) clampPointArena(p);
}
