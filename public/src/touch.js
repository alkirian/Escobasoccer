// Controles táctiles: joystick flotante (apuntar) + 2 botones (acelerar,
// golpe). Es una capa aparte del mouse/teclado, no lo reemplaza — se activa
// sola al detectar el primer touch real, así un dispositivo híbrido
// (notebook con pantalla táctil) no muestra los dos controles a la vez.
//
// Recorte deliberado para la v1 móvil: freno y boost quedan afuera (con 2
// pulgares ya es mucho apuntar + acelerar + golpear). El joystick no fija
// una posición: aparece donde tocás, como en la mayoría de los shooters
// móviles — más cómodo que perseguir un círculo fijo con el pulgar.
import { t } from './i18n/i18n.js';

export class TouchControls {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;
    this.onFirstTouch = null;

    this.joyId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.joyKnob = { x: 0, y: 0 };
    this.dirX = 0; this.dirY = -1;
    this.hasDir = false;

    this.thrustId = null;
    this.thrust = false;
    this.hitId = null;
    this.hit = false;

    this.thrustTime = 0;
    this.hitTime = 0;

    // Dash por doble toque en la zona del joystick (ver _onStart).
    this.dashTap = false;
    this._lastJoyTapAt = 0;

    this._justTapped = false;

    canvas.addEventListener('touchstart', e => this._onStart(e), { passive: false });
    canvas.addEventListener('touchmove', e => this._onMove(e), { passive: false });
    canvas.addEventListener('touchend', e => this._onEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', e => this._onEnd(e), { passive: false });
  }

  _layout() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    return {
      W, H,
      joyMaxR: 58,
      joyDeadzone: 10,
      thrust: { x: W - 92, y: H - 102, r: 54 },
      hit: { x: W - 198, y: H - 158, r: 44 },
      // Pausa: arriba a la derecha, lejos del marcador (centro) y de los
      // pulgares. En teclado existe P/Esc; en el teléfono no había NINGUNA
      // forma de pausar.
      pause: { x: W - 34, y: 34, r: 24 },
    };
  }

  _onStart(e) {
    e.preventDefault();
    if (!this.active) {
      this.active = true;
      if (this.onFirstTouch) { this.onFirstTouch(); this.onFirstTouch = null; }
    }
    this._justTapped = true;
    // Dónde se tocó: la pantalla de fin de partido tiene BOTONES, y en táctil
    // no hay hover que diga cuál. Sin la posición, un toque en cualquier lado
    // activaría siempre el mismo botón.
    if (e.changedTouches[0]) {
      this.tapPos = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    const L = this._layout();
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      // Pausa: se consume como tap puntual, no como botón sostenido
      if (Math.hypot(x - L.pause.x, y - L.pause.y) <= L.pause.r + 14) {
        this.pauseTap = true;
        continue;
      }
      const dHit = Math.hypot(x - L.hit.x, y - L.hit.y);
      const dThrust = Math.hypot(x - L.thrust.x, y - L.thrust.y);
      if (this.hitId === null && dHit <= L.hit.r + 18) {
        this.hitId = t.identifier; this.hit = true;
      } else if (this.thrustId === null && dThrust <= L.thrust.r + 18) {
        this.thrustId = t.identifier; this.thrust = true;
      } else if (this.joyId === null && x < L.W * 0.55) {
        // Doble toque rápido en la zona del joystick = dash. Es el único
        // gesto libre que quedaba: los dos pulgares ya están ocupados
        // (izquierdo apuntando, derecho en GAS/GOLPE) y un cuarto botón no
        // entra. El doble toque cae naturalmente bajo el pulgar que ya está
        // ahí, y dashear en la dirección que estás apuntando es justo lo que
        // uno quiere.
        const now = performance.now();
        if (now - this._lastJoyTapAt < 280) {
          this.dashTap = true;
          this._lastJoyTapAt = 0;   // no encadenar tres toques en dos dashes
        } else {
          this._lastJoyTapAt = now;
        }
        this.joyId = t.identifier;
        this.joyOrigin.x = Math.min(Math.max(x, 80), L.W * 0.55 - 40);
        this.joyOrigin.y = Math.min(Math.max(y, L.H * 0.3), L.H - 50);
        this.joyKnob.x = this.joyOrigin.x;
        this.joyKnob.y = this.joyOrigin.y;
      }
    }
  }

  _onMove(e) {
    e.preventDefault();
    const L = this._layout();
    for (const t of e.changedTouches) {
      if (t.identifier !== this.joyId) continue;
      let dx = t.clientX - this.joyOrigin.x, dy = t.clientY - this.joyOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > L.joyMaxR) { dx = dx / d * L.joyMaxR; dy = dy / d * L.joyMaxR; }
      this.joyKnob.x = this.joyOrigin.x + dx;
      this.joyKnob.y = this.joyOrigin.y + dy;
      if (d > L.joyDeadzone) {
        const nd = Math.hypot(dx, dy) || 1;
        this.dirX = dx / nd; this.dirY = dy / nd;
        this.hasDir = true;
      }
    }
  }

  _onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.joyKnob.x = this.joyOrigin.x; this.joyKnob.y = this.joyOrigin.y;
      }
      if (t.identifier === this.thrustId) { this.thrustId = null; this.thrust = false; }
      if (t.identifier === this.hitId) { this.hitId = null; this.hit = false; }
    }
  }

  tick(dt) {
    if (this.thrust) this.thrustTime += dt;
    if (this.hit) this.hitTime += dt;
  }

  // Dirección de apunte (relativa, no un punto del mundo), o null si
  // todavía no hubo ningún arrastre del joystick.
  aimDir() { return this.hasDir ? { x: this.dirX, y: this.dirY } : null; }

  // ¿Tocaron el botón de pausa? Un tap = un toggle.
  consumePauseTap() {
    if (this.pauseTap) { this.pauseTap = false; return true; }
    return false;
  }

  // ¿Hubo doble toque de dash desde la última consulta? Se consume al leerlo
  // para que un gesto dispare exactamente un dash.
  consumeDashTap() {
    if (this.dashTap) { this.dashTap = false; return true; }
    return false;
  }

  // Toque nuevo sin consumir — se usa para "tocar para jugar otra" en la
  // pantalla de fin de partido.
  consumeTap() {
    if (this._justTapped) { this._justTapped = false; return true; }
    return false;
  }

  draw(ctx, W, H) {
    if (!this.active) return;
    const L = this._layout();
    ctx.save();

    if (this.joyId !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(20,16,40,0.32)';
      ctx.beginPath(); ctx.arc(this.joyOrigin.x, this.joyOrigin.y, L.joyMaxR, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(this.joyKnob.x, this.joyKnob.y, 26, 0, 7); ctx.fill();
    }

    this._button(ctx, L.thrust, this.thrust, t('touch.gas'), '#3fc0ff');
    this._button(ctx, L.hit, this.hit, t('touch.hit'), '#ffd76a');

    // Botón de pausa: dos barras, discreto
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(L.pause.x, L.pause.y, L.pause.r * 0.8, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(L.pause.x - 6, L.pause.y - 8, 4, 16);
    ctx.fillRect(L.pause.x + 2, L.pause.y - 8, 4, 16);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  _button(ctx, zone, pressed, label, color) {
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.r, 0, 7);
    ctx.fillStyle = pressed ? color : 'rgba(255,255,255,0.14)';
    ctx.globalAlpha = pressed ? 0.55 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pressed ? color : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = pressed ? '#12101f' : 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, zone.x, zone.y);
  }
}
