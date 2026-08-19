// Orbes de energía — el recurso mágico del juego.
// Repartidos por la arena: los del centro caen sobre la ruta directa a la
// pelota, los de los costados obligan a desviarse. Ahí está la decisión
// estratégica: ir por la pelota, o cargar energía para la próxima jugada.
import { CFG } from './config.js';
import { clamp, rand } from './utils.js';

export class Orb {
  constructor(x, y, phase) {
    this.x = x;
    this.y = y;
    this.phase = phase;   // desfase del flotar, para que no laten todos igual
    this.alive = true;
    this.respawnT = 0;
    this.fade = 1;        // 0..1, animación de regreso
    this.pop = 0;         // destello al ser consumido (no al ser tocado)
    // Enganchado: al entrar en pickupR no desaparece, vuela hacia el
    // jugador que lo tocó hasta alcanzarlo de verdad. `x,y` (el punto de
    // spawn) queda intacto todo este tiempo, así que al respawnear vuelve
    // exactamente a su lugar en el layout, no a donde lo agarraron.
    this.caught = false;
    this.catcher = null;
    this.flyX = x;
    this.flyY = y;
  }

  // Posición efectiva: en vuelo hacia el jugador, o flotando en su sitio.
  get fx() { return this.caught ? this.flyX : this.x; }
  get fy() {
    if (this.caught) return this.flyY;
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
      o.caught = false;
      o.catcher = null;
    }
  }

  update(dt) {
    const O = CFG.orbs;
    for (const o of this.orbs) {
      o.phase += O.bobSpeed * dt;
      if (o.pop > 0) o.pop = Math.max(0, o.pop - dt * 3);
      if (o.caught) continue; // el vuelo hacia el jugador lo maneja collect()
      if (o.alive) {
        // Regreso gradual: el orbe se materializa, se puede anticipar
        if (o.fade < 1) o.fade = clamp(o.fade + dt / O.fadeIn, 0, 1);
      } else {
        o.respawnT -= dt;
        if (o.respawnT <= 0) { o.alive = true; o.fade = 0; }
      }
    }
  }

  // Al tocar el orbe (pickupR, ahora bien generoso) no se absorbe al
  // instante: queda enganchado y vuela hacia el jugador hasta llegar de
  // verdad — recién ahí se consume. onCollect(orbe, jugador) → efectos y
  // energía, se llama solo en ese momento final.
  collect(players, onCollect, dt = 0) {
    const O = CFG.orbs;
    for (const o of this.orbs) {
      if (o.caught) {
        const catcher = o.catcher;
        const b = catcher?.broom?.pos;
        if (!b) { o.caught = false; o.catcher = null; continue; } // por si el jugador ya no existe
        const dx = b.x - o.flyX, dy = b.y - o.flyY;
        const d = Math.hypot(dx, dy);
        if (d < O.catchDist) {
          // Llegó de verdad: ahora sí se consume.
          o.alive = false;
          o.respawnT = O.respawn;
          o.pop = 1;
          o.caught = false;
          o.catcher = null;
          onCollect?.(o, catcher, o.flyY);
          continue;
        }
        // Piso de velocidad + margen sobre la velocidad del jugador: así
        // nunca se queda atrás aunque vaya acelerando o con impulso.
        const playerSpeed = Math.hypot(catcher.broom.vel.x, catcher.broom.vel.y);
        const speed = Math.max(O.catchSpeed, playerSpeed * 1.3);
        const step = Math.min(speed * dt, d);
        o.flyX += (dx / d) * step;
        o.flyY += (dy / d) * step;
        continue;
      }

      if (!o.alive || o.fade < 0.55) continue; // aún materializándose
      const oy = o.fy;
      for (const p of players) {
        if (!p) continue;
        const b = p.broom.pos;
        if (Math.hypot(b.x - o.fx, b.y - oy) > O.pickupR) continue;
        // Ojo: leer flyX/flyY ANTES de marcar caught=true. El getter fx()
        // bifurca según `caught`, así que si se invierte el orden, en un
        // orbe que ya voló una vez antes (flyX quedó con la última posición
        // de esa persecución) esto se pisa a sí mismo con un valor viejo en
        // vez de la posición real de contacto — usar o.x explícito, no o.fx.
        o.flyX = o.x;
        o.flyY = oy;
        o.caught = true;
        o.catcher = p;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Orbe fugitivo — el premio gordo, y no se deja agarrar.
//
// Cada tanto aparece uno dorado que HUYE de todos los jugadores. Atraparlo da
// energía ilimitada por unos segundos. El balance está en su velocidad: vuela
// más rápido que una escoba normal pero más lento que una con impulso, así
// que para alcanzarlo hay que gastar energía — y lo que reparte es energía.
// Ese es el bucle: apostás la reserva que tenés para ganar reserva infinita.
//
// El partido no se detiene mientras tanto: perseguirlo es dejar la pelota, y
// ahí está la decisión.
// ---------------------------------------------------------------------------
export class RunnerOrb {
  constructor() {
    this.reset(true);
  }

  reset(full = false) {
    const R = CFG.runner;
    this.state = 'idle';        // idle | warn | alive | caught
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.timer = full ? R.firstAt : R.every + rand(-R.everyJitter, R.everyJitter);
    this.lifeT = 0;
    this.pop = 0;
    this.stamina = 1;
    this.trail = [];
    this.wanderPhase = rand(0, 10);
    this.panic = 0;             // 0..1, qué tan acosado está (sube ya, baja lento)
    this.stamina = 1;           // 1 = fresco, 0 = agotado (baja al esprintar)
  }

  get active() { return this.state === 'alive'; }

  // Aparece lejos de todos: que nadie lo tenga servido de arranque.
  _spawn(players) {
    const A = CFG.arena;
    let best = null, bestD = -1;
    for (let i = 0; i < 12; i++) {
      const c = {
        x: rand(A.L + 260, A.R - 260),
        y: rand(A.T + 220, A.B - 220),
      };
      let d = Infinity;
      for (const p of players) {
        if (!p) continue;
        d = Math.min(d, Math.hypot(c.x - p.broom.pos.x, c.y - p.broom.pos.y));
      }
      if (d > bestD) { bestD = d; best = c; }
    }
    this.x = best.x; this.y = best.y;
    this.vx = 0; this.vy = 0;
    this.trail.length = 0;
  }

  // `running` = el partido está en juego. Durante countdown y festejo de gol
  // el fugitivo se congela: no tendría sentido que escape mientras nadie puede
  // perseguirlo.
  update(dt, players, running, hooks) {
    const R = CFG.runner;
    if (this.pop > 0) this.pop = Math.max(0, this.pop - dt * 2.5);
    if (!running) return;

    switch (this.state) {
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) {
          this._spawn(players);
          this.state = 'warn';
          this.timer = R.warn;
          hooks?.onWarn?.(this.x, this.y);
        }
        break;

      case 'warn':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'alive';
          this.lifeT = R.life;
          hooks?.onAppear?.(this.x, this.y);
        }
        break;

      case 'alive':
        this._flee(dt, players);
        this.lifeT -= dt;
        if (this.lifeT <= 0) {   // nadie lo alcanzó: se desvanece
          this.state = 'idle';
          this.timer = R.every + rand(-R.everyJitter, R.everyJitter);
          hooks?.onEscape?.(this.x, this.y);
        }
        break;
    }
  }

  _flee(dt, players) {
    const R = CFG.runner;
    const A = CFG.arena;
    let dx = 0, dy = 0;
    let closest = Infinity;
    this.dodgeT = (this.dodgeT ?? 0) + dt;

    // 1) Huir de cada perseguidor, con peso cuadrático por cercanía
    for (const p of players) {
      if (!p) continue;
      const bx = p.broom.pos.x, by = p.broom.pos.y;
      let ox = this.x - bx, oy = this.y - by;
      const d = Math.hypot(ox, oy) || 1;
      closest = Math.min(closest, d);
      // Sin corte duro: el orbe está SIEMPRE esquivando, no solo cuando el
      // jugador entra en fleeRange. La curva decae con la distancia (cerca
      // empuja fuerte, w→1) pero tiene un piso (0.55): sin piso, lejos el
      // "alejarse" quedaba más débil que el deambular (wander=0.35) y el
      // orbe podía terminar acercándose por puro azar del wander — medido:
      // a 1200 de distancia (casi 2× fleeRange) la distancia BAJABA con el
      // tiempo en vez de subir. Con el piso, "alejarse" siempre le gana al
      // wander, así que el neto es alejarse a cualquier distancia del mapa;
      // el pánico (más abajo) sigue atado a fleeRange y decide la VELOCIDAD,
      // esto solo decide la DIRECCIÓN.
      const w = Math.max(0.55, 1 / (1 + (d / R.fleeRange) ** 2));
      ox /= d; oy /= d;
      // Componente tangencial: en vez de huir en línea recta (fácil de
      // interceptar), escapa en diagonal. Es lo que lo hace sentir vivo y
      // no un objeto empujado.
      //
      // Se apaga con el cansancio, y esto importa más que la velocidad: una
      // escoba tiene mucha inercia para girar, así que un orbe que zigzaguea
      // no se alcanza aunque vueles más rápido que él (medido: corría a 626
      // contra 860 del jugador y la distancia igual oscilaba entre 100 y 380
      // sin cerrar nunca). Agotado esquiva poco y recién ahí converge.
      let dodge = R.dodge * (R.tiredDodge + (1 - R.tiredDodge) * this.stamina);
      // El lado del zigzag ya no sale sólo de la posición del perseguidor (que
      // era estable y por lo tanto aprendible: el jugador le cortaba el ángulo
      // siempre igual). Ahora oscila con ritmo propio, así que el orbe finta a
      // un lado y al otro y no se lo puede anticipar.
      const wave = Math.sin(this.dodgeT * R.dodgeWave + (bx * 0.001));
      const fixed = ((bx * 7 + by * 13) | 0) % 2 ? 1 : -1;
      const side = fixed * (1 - R.dodgeWaveAmt) + wave * R.dodgeWaveAmt;
      dx += (ox - oy * dodge * side) * w;
      dy += (oy + ox * dodge * side) * w;
    }

    // Pánico: sube al instante y baja despacio. Con una rampa lineal simple
    // el orbe sólo corría a tope cuando ya lo tenían encima, y para entonces
    // una escoba sin impulso ya lo había alcanzado — el bucle "gastá energía
    // para ganar energía" se caía. Con `panicGain` satura a media distancia,
    // y la caída lenta evita que se relaje entre dos perseguidores que se
    // turnan.
    const want = clamp((1 - closest / R.fleeRange) * R.panicGain, 0, 1);
    this.panic = Math.max(want, this.panic - R.panicDecay * dt);

    // 2) Evitar las paredes. Sin esto lo acorralan contra un borde al toque.
    const push = (dist, nx, ny) => {
      if (dist >= R.wallMargin) return;
      const w = (1 - dist / R.wallMargin) ** 2 * R.wallWeight;
      dx += nx * w; dy += ny * w;
    };
    push(this.x - A.L, 1, 0);
    push(A.R - this.x, -1, 0);
    push(this.y - A.T, 0, 1);
    push(A.B - this.y, 0, -1);

    // 3) Deambular cuando nadie lo persigue, para que no quede quieto
    this.wanderPhase += dt * 0.7;
    dx += Math.cos(this.wanderPhase * 1.3) * R.wander;
    dy += Math.sin(this.wanderPhase * 1.7 + 1.1) * R.wander;

    // 4) Acelerar hacia la dirección deseada, con tope de velocidad
    const dl = Math.hypot(dx, dy);
    if (dl > 0.001) {
      dx /= dl; dy /= dl;
      this.vx += dx * R.accel * dt;
      this.vy += dy * R.accel * dt;
    }
    // Cansancio: esprintar lo agota, y agotado corre más lento que una escoba
    // normal. Es lo que hace que la persecución tenga arco — con la reserva
    // llena sólo alcanzan ~2 s de impulso, así que sin esto el orbe se
    // escapaba siempre después de esa ventana. Ahora insistir paga: primero
    // gastás el impulso para pegarte, y después lo cansás.
    if (this.panic > 0.5) this.stamina = Math.max(0, this.stamina - R.stamDrain * dt);
    else this.stamina = Math.min(1, this.stamina + R.stamRecover * dt);

    const sp = Math.hypot(this.vx, this.vy);
    // Acosado corre a tope; tranquilo pasea, así se lo puede alcanzar
    const maxSp = R.speed
      * (R.calmSpeed + (1 - R.calmSpeed) * this.panic)
      * (R.tiredSpeed + (1 - R.tiredSpeed) * this.stamina);
    if (sp > maxSp) { this.vx *= maxSp / sp; this.vy *= maxSp / sp; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Nunca fuera de la cancha, pase lo que pase
    const m = R.r;
    if (this.x < A.L + m) { this.x = A.L + m; this.vx = Math.abs(this.vx); }
    if (this.x > A.R - m) { this.x = A.R - m; this.vx = -Math.abs(this.vx); }
    if (this.y < A.T + m) { this.y = A.T + m; this.vy = Math.abs(this.vy); }
    if (this.y > A.B - m) { this.y = A.B - m; this.vy = -Math.abs(this.vy); }

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 16) this.trail.shift();
  }

  // Devuelve el jugador que lo atrapó, o null
  collect(players) {
    if (this.state !== 'alive') return null;
    const R = CFG.runner;
    for (const p of players) {
      if (!p) continue;
      const b = p.broom.pos;
      if (Math.hypot(b.x - this.x, b.y - this.y) > R.pickupR) continue;
      this.state = 'idle';
      this.timer = R.every + rand(-R.everyJitter, R.everyJitter);
      this.pop = 1;
      return p;
    }
    return null;
  }
}
