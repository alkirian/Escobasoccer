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

    // ── Cadena de contragolpes ──────────────────────────────────────────
    // Pegarle a la pelota CONTRA su dirección de vuelo (una devolución de
    // volea, no un empujoncito acompañando) encadena. Cada eslabón la manda
    // más rápido, y a partir del segundo sale en zigzag. `chain` es el nivel
    // actual y `chainT` la ventana para encadenar: si nadie la devuelve a
    // tiempo, se enfría sola y vuelve a cero.
    this.chain = 0;
    this.chainT = 0;
    this.zig = 0;        // amplitud del zigzag (0 = recto)
    this.zigPhase = 0;
    // Rumbo FIJO del disparo, capturado en el momento del golpe. El zigzag
    // oscila alrededor de esta recta, no del rumbo instantáneo.
    this.zigDir = { x: 1, y: 0 };
    this.chainFlash = 0; // destello al encadenar, para el render
  }

  // La llama collisions.js cuando alguien golpea. `vnAntes`/`vnDespues` son
  // la velocidad antes y después del impacto. Devuelve el nivel de cadena
  // alcanzado (0 = no encadenó) para que el que golpea pueda reaccionar
  // (sonido, partículas, sacudón de cámara).
  registerHit(velAntes, velDespues) {
    const C = CFG.ball.chain;
    const spAntes = Math.hypot(velAntes.x, velAntes.y);
    const spDespues = Math.hypot(velDespues.x, velDespues.y);

    // Un contragolpe de verdad: la pelota venía rápido y sale rápido EN
    // SENTIDO CONTRARIO. El producto punto negativo es justo eso — devolverla,
    // no acompañarla. Sin este filtro, cualquier roce mientras la pelota vuela
    // encadenaría y el efecto perdería todo el sentido.
    if (spAntes < C.minIn || spDespues < C.minOut) { return 0; }
    const dot = (velAntes.x * velDespues.x + velAntes.y * velDespues.y)
      / (spAntes * spDespues);
    if (dot > -C.minDot) return 0;    // no es devolución: no encadena

    const yaEncadenando = this.chainT > 0;

    // Para llegar al ZIGZAG (nivel 2+) no alcanza con "devolverla rápido":
    // tiene que ser un jugador B respondiéndole a un jugador A, hacia el lado
    // contrario, y CON MÁS FUERZA que el golpe que recibió. Antes esto último
    // no se pedía — bastaba con superar minOut (fijo), así que cualquier
    // segunda devolución medio decente disparaba el zigzag (medido: 5 veces en
    // 180 s de partido, uno cada ~36 s). Ahora, a partir del segundo eslabón,
    // el ángulo de devolución tiene que ser bastante más de frente y la
    // pelota tiene que salir claramente más fuerte de lo que entró.
    if (yaEncadenando) {
      if (dot > -C.minDotChain) return 0;         // devolución poco de frente
      if (spDespues < spAntes * C.minOutMul) return 0;   // no salió más fuerte
    }

    // Dentro de la ventana suma eslabón; fuera, arranca de nuevo en 1.
    this.chain = yaEncadenando ? Math.min(this.chain + 1, C.maxLevel) : 1;
    this.chainT = C.window;
    this.chainFlash = 1;

    if (this.chain >= 1) {
      // Nivel 1: golpe crítico — el doble de velocidad y estela de fuego.
      // Nivel 2+: además sale zigzagueando camino al arco.
      const mul = 1 + C.speedMul * this.chain;
      this.vel.x = velDespues.x * mul;
      this.vel.y = velDespues.y * mul;
      this.ignite();
      if (this.chain >= 2) {
        this.zig = C.zigAmp * (this.chain - 1);
        this.zigPhase = 0;
        // Se guarda la dirección EXACTA del golpe. El zigzag serpentea a los
        // costados de esta recta, así que la pelota siempre avanza hacia donde
        // el jugador la mandó: es una sensación de fuerza, no de pelota loca.
        const s = Math.hypot(this.vel.x, this.vel.y) || 1;
        this.zigDir = { x: this.vel.x / s, y: this.vel.y / s };
      }
    }
    return this.chain;
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
    // El techo de velocidad sube con la cadena: si no, el "doble de
    // velocidad" del contragolpe lo recortaba este clamp y no se notaba nada.
    const cap = B.maxSpeed * (1 + B.chain.capBonus * this.chain);
    if (sp > cap) {
      this.vel.x *= cap / sp;
      this.vel.y *= cap / sp;
    }

    // ── Zigzag del contragolpe encadenado ───────────────────────────────
    // La pelota serpentea PERO SIEMPRE AVANZANDO hacia donde el jugador la
    // mandó. El rumbo se arma cada frame como "la recta del disparo, desviada
    // un ángulo que oscila": el desvío tiene tope (zigMaxAng), así que nunca
    // se da vuelta.
    //
    // Antes esto era una aceleración perpendicular a la velocidad ACTUAL, y
    // ahí estaba el problema: al curvarse la trayectoria, la perpendicular
    // giraba con ella y se realimentaba. Medido: la pelota giraba 181° y
    // terminaba volviendo hacia atrás — parecía azar, no fuerza.
    if (this.zig > 0.001 && this.chainT > 0) {
      const C = B.chain;
      this.zigPhase += C.zigFreq * dt;
      const sp2 = Math.hypot(this.vel.x, this.vel.y);
      if (sp2 > 1) {
        // Ángulo de desvío respecto de la recta del disparo. La amplitud
        // escala con el nivel de cadena pero está topeada.
        const amp = Math.min(C.zigMaxAng * this.chain * 0.5, C.zigMaxAng);
        const ang = Math.sin(this.zigPhase) * amp;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        // Rotar la dirección FIJA del disparo, no la velocidad actual.
        const dx = this.zigDir.x * cos - this.zigDir.y * sin;
        const dy = this.zigDir.x * sin + this.zigDir.y * cos;
        // Se conserva el módulo: el zigzag no acelera ni frena, sólo desvía.
        this.vel.x = dx * sp2;
        this.vel.y = dy * sp2;
      }
    }

    // Enfriamiento de la cadena: si nadie la devuelve, vuelve a cero.
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) { this.chain = 0; this.zig = 0; }
    }
    if (this.chainFlash > 0) this.chainFlash = Math.max(0, this.chainFlash - dt * 2.2);

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
    // La cadena no sobrevive al saque: si no, el primer toque del punto
    // siguiente encadenaría contra un golpe del punto anterior.
    this.chain = 0;
    this.chainT = 0;
    this.zig = 0;
    this.chainFlash = 0;
    this.lastHitter = null;
  }
}
