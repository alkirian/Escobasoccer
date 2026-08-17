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

    // Métricas de uso para el tutorial progresivo
    this.mouseMoved = 0;
    this.thrustTime = 0;
    this.brakeTime = 0;
    this.tuckTime = 0;
    this.boostTime = 0;

    this.firstGesture = null; // callback para inicializar audio

    canvas.addEventListener('contextmenu', e => e.preventDefault());
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
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this._gesture();
      if (e.code === 'Space') { this.tuck = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boost = true;
      this.justPressed.add(e.code);
    });
    addEventListener('keyup', e => {
      if (e.code === 'Space') this.tuck = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boost = false;
    });
    addEventListener('blur', () => { this.lmb = this.rmb = this.tuck = this.boost = false; });
  }

  _gesture() {
    if (this.firstGesture) { this.firstGesture(); this.firstGesture = null; }
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
