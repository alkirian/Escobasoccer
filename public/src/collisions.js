// Interacciones físicas: cuerpo↔pelota, escoba↔pelota, jugador↔jugador.
// No hay botón de patear: todos los golpes surgen del contacto físico.
import { CFG } from './config.js';
import { closestOnSegment, clamp, lerp } from './utils.js';
import { clampPointArena } from './arena.js';

const FEET = new Set(['footF', 'footB', 'kneeF', 'kneeB']);

// Semi-grosor del palo para colisiones. Escala con el personaje: si la escoba
// se dibuja más gruesa pero choca con el radio viejo, la pelota se le mete
// visiblemente adentro.
const SHAFT_R = 7 * CFG.charScale;

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
  // La potencia se decidió al soltar: carga mantenida × energía de orbes.
  const mul = rider.shotMul || 1;
  let speed = Math.max(W.aimedMinPower, Math.min(contactSpeed * 1.15, W.aimedPower)) * mul;
  // El tiro inflamado tiene piso propio: gastar media reserva siempre paga.
  if (rider.shotFire) speed = Math.max(speed, W.fireMinPower);
  speed = Math.min(speed, CFG.ball.maxSpeed);
  ball.vel.x = ux * speed;
  ball.vel.y = uy * speed;
  if (rider.shotFire) ball.ignite();
  rider.notifyAimedContact(); // conectó: termina la persecución
}

const aimedNow = (rider) => rider.phase === 'whip' && rider.aimed && rider.aimDir;

// El latigazo libre también prende la pelota si venía cargado de energía: lo
// que enciende el fuego es la reserva gastada, no haber apuntado bien.
function maybeIgnite(rider, ball) {
  if (rider.phase === 'whip' && rider.shotFire) ball.ignite();
}

// --- Jugador vs pelota ---
export function interactPlayerBall(player, ball, dt, fx) {
  const B = CFG.ball;
  const aimed = aimedNow(player.rider);
  // Velocidad ANTES de cualquier contacto de este jugador. Se compara al final
  // para saber si hubo golpe y si fue una devolución (contragolpe encadenado).
  const vAntes = { x: ball.vel.x, y: ball.vel.y };

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
      else maybeIgnite(player.rider, ball);
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
  const rsum = ball.r + SHAFT_R;
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

  // ── Contragolpe encadenado ────────────────────────────────────────────
  // Se evalúa UNA vez por jugador y por frame, con la velocidad de entrada y
  // la de salida ya resueltas por toda la física de arriba (cuerpo + escoba).
  // Así da igual con qué parte conectó: lo que decide es si la devolvió.
  const nivel = ball.registerHit(vAntes, ball.vel);
  if (nivel > 0) {
    ball.lastHitter = player;
    fx?.onChainHit?.(ball.pos.x, ball.pos.y, nivel, player);
  }

  // PASIVA de Mordrak — "Robo de esencia": cada golpe fuerte a la pelota le
  // devuelve energía. El umbral de cambio de velocidad distingue un golpe de
  // un roce (conducirla no cuenta), y el enfriamiento corto evita que un
  // contacto sostenido de varios frames farmee la barra.
  if (player.characterId === 'mordrak') {
    const dv = Math.hypot(ball.vel.x - vAntes.x, ball.vel.y - vAntes.y);
    const now = performance.now();
    if (dv > 260 && (!player._esenciaAt || now - player._esenciaAt > 300)) {
      player._esenciaAt = now;
      player.addEnergy(9);
    }
  }
}

// Embestida: el que llega más rápido empuja y desestabiliza al otro.
// La fuerza sale de la velocidad de ACERCAMIENTO entre las escobas, que es lo
// que carga el momento — no de la velocidad del punto de contacto, que en un
// ragdoll oscila y daría empujones aleatorios.
// (nx, ny) apunta del que embiste hacia la víctima.
function applyRam(attacker, victim, nx, ny, cx, cy, ally, fx) {
  const R = CFG.ram;
  if (attacker.ramCd > 0) return;   // sin ráfagas: un empujón por contacto
  const av = attacker.broom.vel, vv = victim.broom.vel;
  const closing = (av.x - vv.x) * nx + (av.y - vv.y) * ny;
  if (closing < R.minSpeed) return;

  // PESO (stat): el que embiste empuja según SU peso, y la víctima resiste
  // según el suyo. Un Zefir chocando a Petra casi no la mueve; al revés, la
  // manda a la tribuna. Es el stat que más se siente en un choque.
  const aMods = attacker.mods, vMods = victim.mods;
  // AURA DE FUEGO: el que atrapó el orbe fugitivo embiste como un ariete.
  // Es el efecto más visible del buff — chocar a alguien envuelto en llamas
  // te saca literalmente de la jugada. Multiplica encima del stat de peso,
  // así un Petra en llamas sigue pegando más fuerte que un Zefir en llamas.
  const aura = attacker.unlimited ? CFG.runner.auraRam : 1;
  const force = Math.min((closing - R.minSpeed) * R.push, R.maxPush * aura)
    * (ally ? R.allyMul : 1)
    * aura
    * (aMods ? aMods.ram : 1)
    * (vMods ? vMods.knockback : 1);

  victim.broom.vel.x += nx * force;
  victim.broom.vel.y += ny * force;
  // Desestabilizar: el giro le arruina el apuntado un instante. Es la parte
  // que convierte el empujón en una jugada y no en un simple desplazamiento.
  victim.broom.angVel += (Math.random() * 2 - 1) * R.spin * (force / R.maxPush);
  // Un empujón fuerte saca del aturdimiento a quien acaba de golpearse contra
  // una pared: recibir un choque encima de otro no debería dejarlo indefenso.
  if (victim.broom.slamT > 0 && force > R.breakSlam) victim.broom.slamT = 0;
  // El cuerpo sale despedido por su cuenta: el ragdoll hace el resto
  for (const { p } of victim.rider.hitPoints()) {
    p.px -= nx * force * R.bodyKnock;
    p.py -= ny * force * R.bodyKnock;
  }
  // Riesgo/recompensa: embestir cuesta velocidad al que embiste
  attacker.broom.vel.x -= nx * force * R.recoil;
  attacker.broom.vel.y -= ny * force * R.recoil;

  // PASIVA de Petra — "Muralla": embestirla es mala idea. El atacante rebota
  // con el doble del retroceso normal y sale girando; ella ya casi ni se
  // mueve por su peso 5. Chocar a la muralla castiga al que choca.
  if (victim.characterId === 'petra' && !ally) {
    attacker.broom.vel.x -= nx * force * 1.6;
    attacker.broom.vel.y -= ny * force * 1.6;
    attacker.broom.angVel += (Math.random() * 2 - 1) * R.spin * 1.2;
    fx?.onImpact(cx, cy, closing * 1.4, 'wall');
  }

  attacker.ramCd = R.cooldown;
  fx?.onImpact(cx, cy, closing, 'ram');
}

// --- Jugador vs jugador: embestidas, empujones, enganches temporales ---
export function interactPlayers(pa, pb, dt, fx) {
  const ptsA = pa.rider.hitPoints(), ptsB = pb.rider.hitPoints();
  // A un compañero se lo mueve apenas: chocarse entre aliados es humor,
  // no una herramienta para sacárselo de encima.
  const ally = pa.team === pb.team;

  // cuerpos entre sí: separación posicional (el verlet crea el caos) y, si
  // uno viene lanzado, empujón de verdad. Antes solo se separaban, así que
  // tirarle el cuerpo encima a un rival no hacía absolutamente nada.
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
      // Los dos sentidos: applyRam solo dispara para el que realmente cierra
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      applyRam(pa, pb, nx, ny, mx, my, ally, fx);
      applyRam(pb, pa, -nx, -ny, mx, my, ally, fx);
    }
  }

  // escoba de A contra cuerpo de B (y viceversa) → embestidas
  broomVsBody(pa, ptsB, pb, dt, fx, ally);
  broomVsBody(pb, ptsA, pa, dt, fx, ally);

  // escoba vs escoba: choque de palos
  broomVsBroom(pa, pb, fx, ally);
}

function broomVsBody(attacker, points, victim, dt, fx, ally) {
  const tip = attacker.broom.tip(), tail = attacker.broom.tail();
  for (const { p } of points) {
    const c = closestOnSegment(p.x, p.y, tail.x, tail.y, tip.x, tip.y);
    const dx = p.x - c.x, dy = p.y - c.y;
    const rsum = p.r + SHAFT_R;
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
      // el palo empuja el punto del cuerpo (efecto local, siempre)
      p.px = p.x - (pv.x + nx * rvn * 0.8) * dt;
      p.py = p.y - (pv.y + ny * rvn * 0.8) * dt;
    }
    // El empujón grande lo decide la velocidad de acercamiento entre escobas
    applyRam(attacker, victim, nx, ny, c.x, c.y, ally, fx);
  }
}

function broomVsBroom(pa, pb, fx, ally) {
  const A = pa.broom, Bb = pb.broom;
  const aPts = [A.tail(), A.pos, A.tip()];
  const tipB = Bb.tip(), tailB = Bb.tail();
  for (const q of aPts) {
    const c = closestOnSegment(q.x, q.y, tailB.x, tailB.y, tipB.x, tipB.y);
    const dx = q.x - c.x, dy = q.y - c.y;
    const rsum = SHAFT_R * 2;
    const d = Math.hypot(dx, dy);
    if (d >= rsum || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    const va = A.velAt(q.x, q.y), vb = Bb.velAt(c.x, c.y);
    const vn = (va.x - vb.x) * nx + (va.y - vb.y) * ny;
    // separar
    A.pos.x += nx * (rsum - d) * 0.4; A.pos.y += ny * (rsum - d) * 0.4;
    Bb.pos.x -= nx * (rsum - d) * 0.4; Bb.pos.y -= ny * (rsum - d) * 0.4;
    if (vn < 0) {
      // Entre compañeros el rebote es más blando: chocarse igual estorba
      // (no se atraviesan), pero no se mandan a volar entre ellos.
      const j = -vn * (ally ? 0.28 : 0.55);
      A.applyImpulseAt(q.x, q.y, nx * j, ny * j);
      Bb.applyImpulseAt(c.x, c.y, -nx * j, -ny * j);
      if (-vn > 150) fx?.onImpact(c.x, c.y, -vn, 'clack');
    }
    // Palo contra palo también sirve para sacar al rival de posición
    applyRam(pa, pb, -nx, -ny, c.x, c.y, ally, fx);
    applyRam(pb, pa, nx, ny, c.x, c.y, ally, fx);
  }
}

// Mantener los cuerpos dentro de la arena
export function clampRiderArena(player) {
  for (const { p } of player.rider.hitPoints()) clampPointArena(p);
}
