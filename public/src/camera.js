// Cámara de gameplay: sigue el PROMEDIO entre el jugador y la pelota, con un
// zoom que se acerca cuando el jugador tiene la pelota cerca (la jugada está
// en marcha) y se aleja cuando está lejos (más contexto para ubicarse). Ya
// no muestra el mapa completo — por eso existen los indicadores de "arco
// fuera de cámara" en render.js.
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

  // El tope evita que una cadena de impactos deje la pantalla temblando sin
  // control. Reservado para momentos grandes (goal blast) — los golpes
  // sueltos del juego ya no sacuden la cámara, se sentía demasiado.
  shake(m, cap = 26) { this.shakeMag = Math.min(this.shakeMag + m, cap); }

  // Presentación: arranca pegada al mago (para ver skin, capa y sombrero) y
  // se abre revelando rival, pelota, portales y límites, terminando exacto en
  // el encuadre de gameplay. `focus` es el jugador a mostrar.
  startIntro(focus) {
    this.introT = 0;
    this.introFocus = focus;
  }

  get inIntro() { return this.introT != null && this.introT < CFG.intro.time; }

  // Zoom de referencia del encuadre de juego.
  //
  // Antes esto era min(W/imgW, H/imgH): encajaba la IMAGEN entera en pantalla,
  // así que cualquier monitor con otra proporción quedaba con bandas negras
  // enormes (en 1920x720 la cancha era una estampilla en el medio).
  //
  // Ahora se combinan dos criterios:
  //   cover = llenar la pantalla con la imagen, sin bandas (max en vez de min)
  //   fit   = el zoom máximo que todavía deja ver TODA la zona jugable
  // y se toma el menor de los dos. Así por defecto se llena la pantalla, pero
  // si llenarla implicara recortar cancha, se cede un poco y aparece una banda
  // mínima. Nunca se pierde zona de juego, que es lo que no se puede negociar.
  baseZoom() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const A = CFG.arena;
    const cover = Math.max(W / A.imgW, H / A.imgH);
    // Zona jugable + un margen de aire para que nada quede pegado al borde
    const playW = (A.R - A.L) * 1.04;
    const playH = (A.B - A.T) * 1.04;
    const fit = Math.min(W / playW, H / playH);
    return Math.min(cover, fit);
  }

  // focus/ball: {x,y} en mundo. Si no se pasan (escenas viejas/de prueba),
  // cae en la cámara fija centrada, como antes.
  update(dt, focus, ball) {
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
      // Cámara fija, centrada en la ZONA JUGABLE (no en el centro de la
      // imagen). La cancha no está centrada verticalmente en el mapa: va de
      // arena.T a arena.B, cuyo punto medio está bastante por encima de y=0.
      // Mirando a 0 se recortaba techo de cancha mientras sobraba piso pintado.
      const cy = (CFG.arena.T + CFG.arena.B) / 2;
      this.zoom = damp(this.zoom, base, 4, dt);
      this.x = damp(this.x, 0, 4, dt);
      this.y = damp(this.y, cy, 4, dt);
    }

    // Empuje sutil de velocidad: acerca un pelín cuando se vuela muy rápido.
    // Es un acento, nunca compromete la lectura del partido.
    if (this.speedPunch > 0.001) {
      this.zoom *= 1 + this.speedPunch * 0.045;
      this.speedPunch = damp(this.speedPunch, 0, 5, dt);
    }

    // Nunca mostrar más allá del borde del mapa pintado: el paneo dinámico
    // podría llevar la cámara a asomarse al vacío negro de afuera.
    {
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      const halfImgW = CFG.arena.imgW / 2, halfImgH = CFG.arena.imgH / 2;
      const viewHW = W / 2 / this.zoom, viewHH = H / 2 / this.zoom;
      const limX = Math.max(0, halfImgW - viewHW);
      const limY = Math.max(0, halfImgH - viewHH);
      this.x = clamp(this.x, -limX, limX);
      this.y = clamp(this.y, -limY, limY);
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
