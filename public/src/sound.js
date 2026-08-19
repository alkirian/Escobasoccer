// Sonido 100% sintetizado con WebAudio (sin assets).
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.thrustGain = null;
    this.windGain = null;
    this.lastImpact = 0;
    // Silencio total (opción del menú). Se corta en init(): sin AudioContext
    // no hay nada que sonar, así que ningún método de abajo hace ruido — todos
    // salen temprano si `this.ctx` es null.
    this.muted = false;
  }

  init() {
    if (this.ctx || this.muted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // Ruido blanco compartido
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Propulsión: ruido filtrado + sub
    this.thrustGain = this._loop(320, 'lowpass', 0.0);
    // Viento: ruido más agudo, gana con la velocidad
    this.windGain = this._loop(900, 'bandpass', 0.0);
  }

  _loop(freq, type, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    return g;
  }

  setThrust(p) {
    if (!this.ctx) return;
    this.thrustGain.gain.setTargetAtTime(p * 0.22, this.ctx.currentTime, 0.08);
  }

  setWind(speed) {
    if (!this.ctx) return;
    this.windGain.gain.setTargetAtTime(Math.min(speed / 900, 1) * 0.1, this.ctx.currentTime, 0.15);
  }

  _blip(freq, dur, type = 'sine', vol = 0.3, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  impact(strength) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastImpact < 60) return; // no saturar
    this.lastImpact = now;
    const s = Math.min(strength / 800, 1);
    const t = this.ctx.currentTime;
    // thump grave
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130 + s * 70, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25 + s * 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
    // chasquido de ruido
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 + s * 1600;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12 + s * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(f).connect(ng).connect(this.master);
    src.start(t); src.stop(t + 0.12);
  }

  beep(final = false) {
    this._blip(final ? 880 : 440, final ? 0.5 : 0.14, 'square', 0.16);
  }

  goal() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => this._blip(n, 0.35, 'triangle', 0.3, i * 0.09));
    this._blip(262, 0.6, 'sawtooth', 0.12, 0);
  }

  golden() {
    [392, 494, 587, 740, 880].forEach((n, i) => this._blip(n, 0.5, 'triangle', 0.25, i * 0.12));
  }

  whistle() {
    this._blip(1600, 0.4, 'square', 0.1);
    this._blip(1585, 0.4, 'square', 0.1, 0.02);
  }

  // Recolección de orbe: chispa corta y brillante que sube
  orb() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.18);
    this._blip(2100, 0.07, 'sine', 0.07, 0.03);
  }

  // El orbe fugitivo se materializa: campanada mágica ascendente que llama
  // la atención aunque esté fuera de cámara
  runnerAppear() {
    [523, 784, 1047].forEach((n, i) => this._blip(n, 0.45, 'triangle', 0.22, i * 0.11));
  }

  // Atrapado: fanfarria corta y dorada
  runnerCatch() {
    [659, 880, 1175, 1568].forEach((n, i) => this._blip(n, 0.4, 'triangle', 0.26, i * 0.07));
    this._blip(330, 0.5, 'sawtooth', 0.13);
  }

  // Boost sostenido: se conecta al mismo lazo de propulsión pero más grave
  setBoost(p) {
    if (!this.ctx) return;
    if (!this.boostGain) this.boostGain = this._loop(140, 'lowpass', 0);
    this.boostGain.gain.setTargetAtTime(p * 0.16, this.ctx.currentTime, 0.06);
  }

  // Explosión del gol: golpe grave largo + barrido de ruido
  blast() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 1);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(280, t + 0.6);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    src.connect(f).connect(ng).connect(this.master);
    src.start(t); src.stop(t + 0.7);
  }

  // Escoba clavándose en una superficie: madera/piedra
  thunk() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }

  // Desprenderse de golpe
  pop() {
    this._blip(320, 0.13, 'sawtooth', 0.22);
    this._blip(760, 0.1, 'triangle', 0.14, 0.02);
  }

  // ── Ambiente del partido ──────────────────────────────────────────────
  // Una cama sonora generativa en vez de un loop grabado: viento grave +
  // punteos pentatónicos espaciados al azar. Al no repetirse nunca, no cansa
  // — el peligro número uno de la música de fondo en partidas largas.
  // Idempotente: se puede llamar cada frame con true/false sin costo.
  setAmbient(on) {
    if (!this.ctx) return;
    if (on && !this._ambient) {
      this._ambient = true;
      // Viento de fondo, más grave y quieto que el viento de velocidad
      if (!this.ambientGain) this.ambientGain = this._loop(240, 'lowpass', 0);
      this.ambientGain.gain.setTargetAtTime(0.045, this.ctx.currentTime, 1.2);
      // Punteos: nota pentatónica cada 1.2–2.8 s, a veces con quinta, a
      // veces silencio. Volumen bajísimo: es textura, no melodía.
      const NOTES = [220, 261.6, 293.7, 329.6, 392, 440, 523.3];
      const pluck = () => {
        if (!this._ambient) return;
        if (Math.random() < 0.62) {
          const n = NOTES[(Math.random() * NOTES.length) | 0];
          this._blip(n, 1.4, 'triangle', 0.045);
          if (Math.random() < 0.35) this._blip(n * 1.5, 1.2, 'sine', 0.028, 0.12);
          if (Math.random() < 0.2) this._blip(n / 2, 1.8, 'sine', 0.03, 0.05);
        }
        this._ambientTimer = setTimeout(pluck, 1200 + Math.random() * 1600);
      };
      pluck();
    } else if (!on && this._ambient) {
      this._ambient = false;
      clearTimeout(this._ambientTimer);
      this.ambientGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
    }
  }

  // Fanfarria de victoria: acorde mayor ascendente con remate
  stingWin() {
    if (!this.ctx) return;
    const seq = [392, 523, 659, 784];
    seq.forEach((n, i) => this._blip(n, 0.55, 'triangle', 0.26, i * 0.13));
    this._blip(1047, 1.0, 'triangle', 0.3, seq.length * 0.13);
    this._blip(262, 1.2, 'sawtooth', 0.1, seq.length * 0.13);
    this._blip(1568, 0.5, 'sine', 0.1, seq.length * 0.13 + 0.1);
  }

  // Derrota: dos notas descendentes, cortas — reconoce el momento sin
  // restregarlo. Perder tiene que doler poco para que "otra" salga solo.
  stingLose() {
    if (!this.ctx) return;
    this._blip(330, 0.5, 'triangle', 0.2);
    this._blip(247, 0.9, 'triangle', 0.18, 0.28);
  }

  // Desafío completado: campanita doble brillante
  stingChallenge() {
    if (!this.ctx) return;
    this._blip(1047, 0.35, 'triangle', 0.2);
    this._blip(1568, 0.6, 'triangle', 0.22, 0.12);
  }
}
