// Entrada: mouse (apuntar, LMB thrust, RMB freno) + Space (recogerse)
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 }; // en pantalla
    this.lmb = false;
    this.rmb = false;
    this.tuck = false;
    this.boost = false;
    this.justPressed = new Set();
    this.held = new Set();   // teclas mantenidas (lo usa el modo WASD)

    // Métricas de uso para el tutorial progresivo
    this.mouseMoved = 0;
    this.thrustTime = 0;
    this.brakeTime = 0;
    this.tuckTime = 0;
    this.boostTime = 0;

    this.firstGesture = null; // callback para inicializar audio

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // El juego no usa la rueda: sobre el canvas se bloquea para que el
    // gesto no scrollee la página contenedora del iframe.
    canvas.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('mousemove', e => {
      this.mouseMoved += Math.hypot(e.movementX || 0, e.movementY || 0);
      this.cursor.x = e.clientX;
      this.cursor.y = e.clientY;
    });
    canvas.addEventListener('mousedown', e => {
      this._gesture();
      if (e.button === 0) { this.lmb = true; this.justPressed.add('lmb'); }
      if (e.button === 2) this.rmb = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    // Teclas que el navegador usa para scrollear. Dentro de un iframe de
    // portal, dejarlas pasar mueve la página CONTENEDORA mientras jugás.
    const SCROLL_KEYS = new Set([
      'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'PageUp', 'PageDown', 'Home', 'End',
    ]);
    addEventListener('keydown', e => {
      // El preventDefault va ANTES del corte por e.repeat: mantener Espacio
      // apretado dispara repeticiones, y cada una sin prevenir scrollea al
      // padre. Solo se bloquea si el foco no está en un campo de texto.
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
      if (SCROLL_KEYS.has(e.code) && !typing) e.preventDefault();
      if (e.repeat) return;
      this._gesture();
      if (e.code === 'Space') this.tuck = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boost = true;
      this.held.add(e.code);
      this.justPressed.add(e.code);
    });
    addEventListener('keyup', e => {
      if (e.code === 'Space') this.tuck = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boost = false;
      this.held.delete(e.code);
    });
    addEventListener('blur', () => {
      this.lmb = this.rmb = this.tuck = this.boost = false;
      this.held.clear();
    });
  }

  _gesture() {
    if (this.firstGesture) { this.firstGesture(); this.firstGesture = null; }
    // A diferencia de firstGesture (una sola vez, crea el AudioContext), este
    // hook corre en CADA gesto: reanuda el contexto si el navegador lo
    // suspendió al cambiar de pestaña.
    this.onGesture?.();
  }

  // Consumir tecla recién presionada (para pausa/restart)
  pressed(code) {
    if (this.justPressed.has(code)) { this.justPressed.delete(code); return true; }
    return false;
  }

  tick(dt) {
    if (this.lmb) this.thrustTime += dt;
    if (this.rmb) this.brakeTime += dt;
    if (this.tuck) this.tuckTime += dt;
    if (this.boost) this.boostTime += dt;
  }

  endFrame() { this.justPressed.clear(); }
}
