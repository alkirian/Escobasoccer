// Cámara fija: el mapa ES la imagen, así que siempre se ve entera y no se
// mueve. No hay paneo ni zoom dinámico — el jugador lee toda la cancha de un
// vistazo, como en una pizarra. Lo único que se mueve es el shake de impactos.
import { CFG } from './config.js';
import { damp, clamp, lerp } from './utils.js';

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 0.5;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.introT = null;
    this.introFocus = null;
    this.speedPunch = 0;
  }

  shake(m) { this.shakeMag = Math.min(this.shakeMag + m, 26); }

  // Presentación: arranca pegada al mago (para ver skin, capa y sombrero) y
  // se abre revelando rival, pelota, portales y límites, terminando exacto en
  // el encuadre de gameplay. `focus` es el jugador a mostrar.
  startIntro(focus) {
    this.introT = 0;
    this.introFocus = focus;
  }

  get inIntro() { return this.introT != null && this.introT < CFG.intro.time; }

  // Zoom base del gameplay: "contain", el mapa completo siempre visible
  baseZoom() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    return Math.min(W / CFG.arena.imgW, H / CFG.arena.imgH);
  }

  update(dt) {
    const base = this.baseZoom();

    if (this.inIntro) {
      const I = CFG.intro;
      this.introT += dt;
      const t = clamp(this.introT / I.time, 0, 1);
      // Se queda cerca un momento y recién después se abre, con salida suave
      const k = clamp((t - I.holdFrac) / (1 - I.holdFrac), 0, 1);
      const eased = k * k * (3 - 2 * k); // smoothstep
      const f = this.introFocus;
      this.zoom = lerp(base * I.startZoom, base, eased);
      // El encuadre viaja del mago al centro de la cancha
      this.x = lerp(f ? f.broom.pos.x : 0, 0, eased);
      this.y = lerp(f ? f.broom.pos.y : 0, 0, eased);
    } else {
      this.introT = null;
      // Cámara fija de gameplay: el mapa completo, sin paneo ni zoom
      this.zoom = base;
      this.x = 0;
      this.y = 0;
    }

    // Empuje sutil de velocidad: acerca un pelín cuando se vuela muy rápido.
    // Es un acento, nunca compromete la lectura del partido.
    if (this.speedPunch > 0.001) {
      this.zoom *= 1 + this.speedPunch * 0.045;
      this.speedPunch = damp(this.speedPunch, 0, 5, dt);
    }

    this.shakeMag = damp(this.shakeMag, 0, 7, dt);
    this.shakeX = (Math.random() * 2 - 1) * this.shakeMag;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeMag;
  }

  // La llama el juego según la velocidad del jugador (0..1)
  setSpeedPunch(v) { this.speedPunch = Math.max(this.speedPunch, v); }

  applyTransform(ctx) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    ctx.translate(W / 2, H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.shakeX, -this.y + this.shakeY);
  }

  screenToWorld(sx, sy) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    return {
      x: (sx - W / 2) / this.zoom + this.x - this.shakeX,
      y: (sy - H / 2) / this.zoom + this.y - this.shakeY,
    };
  }
}
