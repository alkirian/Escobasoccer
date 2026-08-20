// Render 2.5D: el mapa ES la imagen "1 mapa.jpeg", dibujada dentro de la
// transformación de mundo para que arte y física queden alineados 1:1.
// Los personajes salen del ragdoll físico y proyectan sombra en el césped.
import { CFG } from './config.js';
import { portalCenter } from './arena.js';
import { clamp, lerp } from './utils.js';
import { t as tr } from './i18n/i18n.js';
import { loadSkin, loadBroomSkin } from './skin.js';
import { CHARACTERS } from './characters.js';
import { loadVSkin, drawVSkin, vskinEnabled } from './vecskin.js';

// Escala del personaje. Las POSICIONES ya vienen escaladas desde la física
// (el ragdoll usa posturas multiplicadas por esto), así que acá sólo hay que
// escalar lo que se dibuja "encima" de esas posiciones: grosores de trazo,
// radios de cabeza y manos, y la geometría del sombrero y la escoba.
const S = CFG.charScale;

export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.t = 0;

    this.mapImg = new Image();
    this.mapReady = false;
    this.mapImg.onload = () => { this.mapReady = true; };
    this.mapImg.src = CFG.arena.src;


    // Skin de sprites hecho en /editor. Si hay uno guardado y está completo,
    // reemplaza al dibujo geométrico. La física no cambia: el ragdoll sigue
    // moviendo los mismos huesos, solo cambia lo que se pinta encima.
    //
    // Por defecto el juego usa el mago VECTORIAL, aunque haya skins guardados:
    // es el look base del proyecto. Los PNG del editor siguen en localStorage
    // intactos —el editor los abre igual— y se activan con `?skin` en la URL,
    // o desde la consola con `renderer.useSkins(true)`.
    this.skin = null;
    this.broomSkin = null;
    this.skinsEnabled = new URLSearchParams(location.search).has('skin');
    if (this.skinsEnabled) this._loadSkins();

    // Skin vectorial hecho en /veditor.html. Es síncrono (sin imágenes), así
    // que se carga acá directo. El editor lo activa/desactiva con su toggle.
    this.vskin = loadVSkin();
    this.vskinOn = vskinEnabled();
  }

  _loadSkins() {
    loadSkin().then(s => { if (s?.ready) this.skin = s; });
    loadBroomSkin().then(s => { if (s?.ready) this.broomSkin = s; });
  }

  // Alterna entre el mago vectorial y los sprites del editor sin recargar.
  // Apagar solo suelta las referencias: lo guardado no se toca.
  useSkins(on = true) {
    this.skinsEnabled = !!on;
    if (on) this._loadSkins();
    else { this.skin = null; this.broomSkin = null; }
    return this.skinsEnabled;
  }

  draw(world, dtFrame) {
    this.t += dtFrame;
    this._dt = dtFrame;   // para animaciones con física propia (confetti)

    // Arranque del "¡YA!": se dispara en la transición countdown→play, que es
    // el único momento en que corresponde. Vive acá y no en el HUD porque el
    // HUD puede no dibujarse (replay activo) y perderíamos la transición.
    const st = world.match?.state;
    if (st === 'play' && this._prevState === 'countdown') this._yaUntil = this.t + 0.8;
    this._prevState = st;
    // El HUD (DOM) muestra el cartel; acá solo se decide CUÁNDO.
    world.yaVisible = st === 'play' && this._yaUntil > this.t;
    const ctx = this.ctx;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;

    // Fuera del mapa: negro de sala, para que el encuadre no distraiga.
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#08061a';
    ctx.fillRect(0, 0, W, H);

    // Repetición del gol: sustituye por completo la escena en vivo.
    if (world.replay?.active) { this._drawReplay(ctx, world, W, H); return; }

    ctx.save();
    world.camera.applyTransform(ctx);

    this._map(ctx);
    // Atmósfera sobre el mapa: tiñe el escenario pintado, no a los
    // personajes que vienen después.
    //
    // Los focos de antorcha se quitaron: sumaban manchas cálidas por toda la
    // pantalla y competían con los personajes justo donde más hace falta
    // leerlos (el amontonamiento del 2v2). El método `_torchLight` queda por
    // si alguna vez se quiere un modo "atmosférico", pero no se llama.
    this._atmosphere(ctx);
    this._portalAura(ctx, -1, world);
    this._portalAura(ctx, 1, world);
    this._shadows(ctx, world);
    if (world.orbs) this._orbs(ctx, world.orbs);
    if (world.runner) this._runner(ctx, world.runner);

    world.particles.draw(ctx);

    this._ballTrail(ctx, world.ball);
    // Estela fantasma del dash: detrás de los cuerpos, delante del fondo
    this._ghostTrail(ctx, world);
    // El humano se dibuja último para que nunca quede tapado por otro cuerpo
    const list = world.players || [world.playerA, world.playerB].filter(Boolean);

    // ── Discos de equipo ──────────────────────────────────────────────────
    // En 2v2 los cuatro magos se leían como manchas del mismo tamaño: el
    // color de bando vive en detalles chicos (tabardo, faja, bufanda) que a
    // distancia de juego se pierden entre las líneas del cuerpo y la escoba.
    // Un disco plano bajo cada uno, del color del equipo, resuelve eso: va
    // DEBAJO de todos los cuerpos, así el amontonamiento no lo tapa, y como
    // es una forma sólida sin líneas no agrega ruido — al contrario, agrupa.
    if (list.length > 2) for (const pl of list) this._teamDisc(ctx, pl, world);
    for (const pl of list) {
      if (pl === world.playerA) continue;
      const c = this._teamColors(pl);
      this._player(ctx, pl, c.main, c.dark, world);
    }
    const cA = this._teamColors(world.playerA);
    // Halo DEBAJO del jugador: va antes de dibujarlo para que quede por detrás
    // y no le lave los colores al skin. Es la señal que sobrevive al desorden —
    // con la pantalla llena de partículas y dos magos encimados, el anillo en
    // el piso sigue diciendo cuál sos.
    // En 2v2 el disco de equipo (con su aro blanco) ya dice cuál sos: sumar
    // además el halo pulsante era una señal encima de otra, justo en el modo
    // donde menos espacio visual hay.
    if (!world.botsMode && list.length <= 2) this._selfHalo(ctx, world.playerA, cA.main);
    this._player(ctx, world.playerA, cA.main, cA.dark, world);
    // La flecha ahora también en 1v1: identificar tu mago de un vistazo importa
    // igual cuando hay uno solo del otro equipo, sobre todo tras un gol cuando
    // la explosión manda a todos por el aire.
    if (!world.botsMode) this._selfMarker(ctx, world.playerA, cA.main);
    // Banderines DESPUÉS de los cuerpos: tienen que asomar por encima del
    // montón, que es justo cuando el disco del piso queda tapado. El del
    // humano no se dibuja porque ya tiene su flecha propia.
    if (list.length > 2) {
      for (const pl of list) if (pl !== world.playerA) this._teamPennant(ctx, pl, world);
    }
    this._ball(ctx, world.ball);
    // Anillos de choque: en espacio de mundo, encima de todo lo que golpean
    this._shockRings(ctx);

    if (world.debug) this._debug(ctx, world);
    // Anillo de carga del golpe (en espacio de mundo, sobre la escoba del jugador)
    if (world.charge) this._spinChargeRing(ctx, world);
    ctx.restore();

    // Luces y viñeta van en espacio de PANTALLA y antes del HUD: la escena
    // se ilumina y se enmarca, pero la interfaz queda siempre legible encima.
    this._lights(ctx, world, W, H);
    this._vignette(ctx, W, H);

    this._aimIndicator(ctx, world);
    // Acá iban las flechas de "arco fuera de cámara" (una por portal) y la del
    // orbe fugitivo. Eran de cuando la cámara seguía al jugador y las cosas se
    // salían de cuadro; con la cámara fija mostrando la cancha entera nunca se
    // cumple esa condición, así que solo quedaban pegadas al borde sin motivo.
    if (world.touch) world.touch.draw(ctx, W, H);
    this._hud(ctx, world, W, H);
    this._challengeToast(ctx, world, W);
    // El confetti vive solo en la pantalla de fin; al salir se descarta para
    // regenerarse fresco en la próxima victoria.
    if (world.match?.state !== 'end') this.confetti = null;
  }

  // ---------- REPETICIÓN DEL GOL ----------
  // Redibuja un frame grabado con la misma maquinaria que la escena en vivo.
  // El truco es reconstruir objetos con la FORMA que esperan `_player` y
  // `_ball` (broom con pos/angle, rider con points/cape): así el mago de la
  // repetición se dibuja con el mismo código que el de verdad, y cualquier
  // cambio de arte vale para los dos sin tocar nada acá.
  _drawReplay(ctx, world, W, H) {
    const rp = world.replay;
    const frame = rp.frameAt(rp.t);
    if (!frame) return;

    ctx.save();
    // Cámara propia de la repetición: más cerca y siguiendo la jugada.
    ctx.translate(W / 2, H / 2);
    ctx.scale(rp.cam.zoom, rp.cam.zoom);
    ctx.translate(-rp.cam.x, -rp.cam.y);

    this._map(ctx);
    this._portalAura(ctx, -1, world);
    this._portalAura(ctx, 1, world);

    // Sombras: las de la repetición salen del snapshot, no del mundo vivo
    for (const p of frame.players) {
      this._groundShadow(ctx, p.broom.x, p.broom.y, 62 * S);
      if (p.points.pelvis) this._groundShadow(ctx, p.points.pelvis.x, p.points.pelvis.y, 26 * S);
    }
    this._groundShadow(ctx, frame.ball.x, frame.ball.y, frame.ball.r * 1.05);

    // Pelota (estela + cuerpo) y magos, en el mismo orden que en vivo
    const ballLike = this._replayBall(frame.ball);
    this._ballTrail(ctx, ballLike);

    const stubs = frame.players.map((p) => this._replayPlayer(p));
    const stubWorld = { botsMode: world.botsMode, playerA: null };
    for (const s of stubs) if (!s.__isHuman) {
      const c = this._teamColors(s);
      this._player(ctx, s, c.main, c.dark, stubWorld);
    }
    const human = stubs.find((s) => s.__isHuman);
    if (human) {
      const c = this._teamColors(human);
      if (!world.botsMode) this._selfHalo(ctx, human, c.main);
      this._player(ctx, human, c.main, c.dark, stubWorld);
    }
    this._ball(ctx, ballLike);

    ctx.restore();
    // Las franjas, el cartel y el progreso de la repetición son DOM (hud.js).
  }

  // Objeto con la forma de Player que `_player` sabe dibujar. Los métodos que
  // el dibujo consulta (tip/tail/dir) se derivan del ángulo guardado.
  _replayPlayer(p) {
    const half = CFG.broom.halfLen;
    const b = p.broom;
    const dir = { x: Math.cos(b.angle), y: Math.sin(b.angle) };
    const broom = {
      pos: { x: b.x, y: b.y },
      vel: { x: b.velX, y: b.velY },
      angle: b.angle,
      thrustPower: b.thrustPower,
      boostPower: b.boostPower,
      brakePower: b.brakePower,
      strain: b.strain,
      stuck: null,
      slamT: 0, slamMag: 0,
      dir: () => dir,
      tip:  () => ({ x: b.x + dir.x * half, y: b.y + dir.y * half }),
      tail: () => ({ x: b.x - dir.x * half, y: b.y - dir.y * half }),
    };
    return {
      __isHuman: p.isHuman,
      team: p.team,
      index: p.index,
      // El personaje que de verdad se jugó (con fallback por si el replay
      // viene de una versión anterior que no lo grababa).
      characterId: p.characterId ?? 'mago',
      broom,
      rider: {
        points: p.points, cape: p.cape, footTrail: [], phase: 'idle',
        // El anillo de carga es un indicador EN VIVO (qué está por hacer el
        // jugador ahora). En una repetición no significa nada, así que se
        // apaga devolviendo carga cero.
        chargeAmount: () => 0,
        isArmed: () => false,
        freezeFlip: null,
        flipSide: Math.cos(b.angle) >= 0 ? 1 : -1,
      },
      energy: 0,
      energyFrac: 0,
      energyPulse: 0,
      unlimitedT: 0,
      unlimited: false,
      control: { aim: { x: b.x, y: b.y } },
    };
  }

  _replayBall(b) {
    return {
      pos: { x: b.x, y: b.y },
      // La velocidad grabada, no cero: el orbe se estira y brilla según cuán
      // rápido va, así que sin esto la repetición lo mostraría siempre inerte.
      vel: { x: b.vx || 0, y: b.vy || 0 },
      r: b.r, rot: b.rot, scale: b.scale, fire: b.fire,
      trail: b.trail,
    };
  }


  // ---------- MAPA ----------
  // La imagen se dibuja DENTRO de la transformación de mundo, a tamaño
  // natural y centrada en el origen. Por eso el mundo usa píxeles de la
  // imagen: cada muro pintado cae exactamente sobre su límite físico.
  // ── Atmósfera del fondo ───────────────────────────────────────────────
  // Profundidad de campo falsa: un velo frío sobre el mapa, más denso arriba
  // (lejos, el cielo) que abajo (cerca, el césped). El fondo retrocede y los
  // personajes saltan hacia adelante sin tocarlos. Un solo fillRect.
  _atmosphere(ctx) {
    const { imgW, imgH, T, B } = CFG.arena;
    // Solo la parte ALTA del mapa (cielo y torres lejanas). Medido: cubrir
    // todo el mapa con velo frío enfriaba el castillo más de lo que las
    // antorchas lo calentaban — los píxeles cálidos bajaban 9.5 puntos y el
    // efecto se anulaba solo. La profundidad se gana separando lejos de
    // cerca, no tiñendo la escena entera.
    const g = ctx.createLinearGradient(0, -imgH / 2, 0, T + (B - T) * 0.35);
    g.addColorStop(0, 'rgba(26,32,72,0.40)');
    g.addColorStop(0.6, 'rgba(22,26,60,0.16)');
    g.addColorStop(1, 'rgba(18,20,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-imgW / 2, -imgH / 2, imgW, (imgH / 2) + T + (B - T) * 0.35);
    // Neblina baja sobre el césped: apoya a los personajes en el suelo.
    const f = ctx.createLinearGradient(0, B - 190, 0, B + 40);
    f.addColorStop(0, 'rgba(120,150,220,0)');
    f.addColorStop(1, 'rgba(120,150,220,0.13)');
    ctx.fillStyle = f;
    ctx.fillRect(-imgW / 2, B - 190, imgW, 230);
  }

  // ── Luz de las antorchas ──────────────────────────────────────────────
  // El castillo tiene antorchas pintadas que hasta ahora no iluminaban nada.
  // Estos focos las hacen existir: manchas cálidas que titilan sobre el mapa
  // y bañan a quien pase cerca. Es EL efecto que integra a los personajes
  // con el escenario en vez de dejarlos flotando encima de una foto.
  //
  // Las posiciones son fracciones del ancho jugable, así siguen calzando si
  // algún día cambia la escala del mapa.
  _torchLight(ctx) {
    const { L, R, B, T } = CFG.arena;
    const w = R - L;
    if (!this._torches) {
      // fx: fracción horizontal · fy: altura en el rango T..B · r: radio
      this._torches = [
        { fx: 0.10, fy: 0.44, r: 300, ph: 0.0 },
        { fx: 0.22, fy: 0.30, r: 240, ph: 1.7 },
        { fx: 0.36, fy: 0.46, r: 270, ph: 3.1 },
        { fx: 0.50, fy: 0.28, r: 250, ph: 4.6 },
        { fx: 0.64, fy: 0.46, r: 270, ph: 0.8 },
        { fx: 0.78, fy: 0.30, r: 240, ph: 2.4 },
        { fx: 0.90, fy: 0.44, r: 300, ph: 5.2 },
      ];
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const t of this._torches) {
      // Titileo: dos senos de distinta frecuencia para que no se note el ciclo
      const flick = 0.82 + 0.18 * Math.sin(this.t * 5.3 + t.ph)
                         + 0.06 * Math.sin(this.t * 11.7 + t.ph * 2);
      const x = L + w * t.fx;
      const y = T + (B - T) * t.fy;
      const r = t.r * flick;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,186,96,${0.26 * flick})`);
      g.addColorStop(0.45, `rgba(255,146,62,${0.12 * flick})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Luces dinámicas ───────────────────────────────────────────────────
  // El salto grande: en vez de que cada cosa brillante pinte su propio halo
  // encima de todo, se juntan TODAS las fuentes de luz en un canvas aparte y
  // se componen de una sola vez con 'screen'. Diferencias que importan:
  //
  //  · las luces se SUMAN entre sí (dos orbes cerca iluminan más que uno),
  //    que es lo que hace que se lea como iluminación y no como calcomanías
  //  · quedan por DEBAJO del HUD, así la interfaz nunca se lava
  //  · un solo drawImage compone todo, sin importar cuántas fuentes haya
  //
  // El offscreen se dibuja a media resolución: la luz es puro degradado
  // suave, así que nadie nota la mitad de píxeles y cuesta 4× menos.
  _lights(ctx, world, W, H) {
    if (!this._lightCv) {
      this._lightCv = document.createElement('canvas');
      this._lightCtx = this._lightCv.getContext('2d');
    }
    const SC = 0.5;                       // media resolución
    const lw = Math.max(2, Math.round(W * SC));
    const lh = Math.max(2, Math.round(H * SC));
    if (this._lightCv.width !== lw || this._lightCv.height !== lh) {
      this._lightCv.width = lw;
      this._lightCv.height = lh;
    }
    const lx = this._lightCtx;
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.clearRect(0, 0, lw, lh);

    // Mismo encuadre que la escena, escalado a la mitad
    const cam = world.camera;
    lx.save();
    lx.scale(SC, SC);
    cam.applyTransform(lx);
    lx.globalCompositeOperation = 'lighter';

    // Un foco = degradado radial que se apaga hacia afuera
    const luz = (x, y, r, col, a) => {
      if (a <= 0.01 || r <= 1) return;
      const g = lx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(0.4, `rgba(${col},${a * 0.35})`);
      g.addColorStop(1, `rgba(${col},0)`);
      lx.fillStyle = g;
      lx.beginPath();
      lx.arc(x, y, r, 0, 7);
      lx.fill();
    };

    // 1) La pelota: siempre brilla; en llamas, mucho más y en naranja
    const b = world.ball;
    if (b) {
      const sp = Math.min(Math.hypot(b.vel.x, b.vel.y) / 1400, 1);
      if (b.fire > 0) luz(b.pos.x, b.pos.y, 220 + sp * 90, '255,150,60', 0.5 * Math.min(b.fire, 1));
      else luz(b.pos.x, b.pos.y, 120 + sp * 110, '255,240,190', 0.16 + sp * 0.2);
    }

    // 2) Los magos: la punta de la escoba y el aura del impulso
    for (const pl of (world.players || [])) {
      if (!pl) continue;
      const br = pl.broom;
      const tip = br.tip();
      const col = pl.team === 'p1' ? '110,200,255' : '255,160,90';
      const thr = br.thrustPower || 0;
      const bst = br.boostPower || 0;
      luz(tip.x, tip.y, 90 + bst * 80, col, 0.14 + thr * 0.12 + bst * 0.24);
      // Aura de fuego: foco grande, cálido y latiendo. Es la señal de "ese
      // está en llamas, no te le cruces" que se lee desde el otro lado de la
      // cancha. El latido usa el reloj del render (no el de cada mago) a
      // propósito: así todos los envueltos en fuego pulsan juntos.
      // El foco es NARANJA y amplio: tiñe la zona de fuego sin lavar al
      // personaje. Un núcleo blanco fuerte lo dejaba como una mancha
      // brillante y se perdían las llamas, que son lo que se quiere ver.
      if (pl.unlimited) {
        const puls = 0.86 + 0.14 * Math.sin(this.t * 9);
        luz(br.pos.x, br.pos.y, 320 * puls, '255,105,20', 0.40);
        luz(br.pos.x, br.pos.y, 165 * puls, '255,170,60', 0.22);
      }
    }

    // 3) Orbes y fugitivo: son fuentes de luz por naturaleza
    if (world.orbs?.orbs) {
      for (const o of world.orbs.orbs) {
        if (o.taken && !o.caught) continue;
        luz(o.fx ?? o.x, o.y, 95, '150,230,255', 0.20);
      }
    }
    if (world.runner?.active) {
      luz(world.runner.x, world.runner.y, 175, '255,215,110', 0.34);
    }

    // 4) Portales: laten con su propio pulso
    for (const side of [-1, 1]) {
      const p = portalCenter(side);
      const col = side < 0 ? '90,180,255' : '255,150,80';
      luz(p.x, p.y, 250 + Math.sin(this.t * 1.6 + side) * 24, col, 0.17);
    }

    // 5) La explosión del gol: el momento más luminoso del juego
    const m = world.match;
    if (m?.state === 'goal' && m.blasted && m.blastWave < 1) {
      const p = portalCenter(m.goalSide);
      const k = 1 - m.blastWave;
      const col = m.goalScorer === 'p1' ? '120,200,255' : '255,170,90';
      luz(p.x, p.y, 300 + m.blastWave * CFG.goalBlast.radius * 0.5, col, 0.75 * k);
    }

    lx.restore();

    // Composición: 'screen' aclara sin quemar — dos luces sumadas nunca
    // pasan del blanco, que es justo cómo se comporta la luz real.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this._lightCv, 0, 0, W, H);
    ctx.restore();
  }

  // ── Disco de equipo (solo 2v2+) ───────────────────────────────────────
  // Elipse rasante bajo cada mago, del color de su bando. Tres decisiones
  // que la hacen funcionar donde el color del traje no alcanza:
  //  · va DEBAJO de todos los cuerpos → el amontonamiento no la tapa
  //  · es una forma SÓLIDA sin líneas → no suma al ruido de trazos
  //  · el compañero lleva un anillo extra → distinguís tu dupla de vos mismo
  _teamDisc(ctx, pl, world) {
    const b = pl.broom;
    const c = this._teamColors(pl);
    const yo = pl === world.playerA;
    const rx = 42 * S, ry = rx * 0.30;
    const y = b.pos.y + 30 * S;

    ctx.save();
    ctx.translate(b.pos.x, y);
    ctx.scale(1, ry / rx);

    // Halo exterior difuso: da presencia sin borde duro
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, c.main);
    g.addColorStop(0.5, c.main);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, 7);
    ctx.fill();

    // Núcleo sólido: es lo que de verdad se lee de lejos. Sin él el disco
    // era tan suave que desaparecía bajo los cuerpos.
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.5, 0, 7);
    ctx.fill();

    // Contorno oscuro: separa el disco del césped en cualquier fondo
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(12,8,24,0.9)';
    ctx.lineWidth = 2.6 * S;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.5, 0, 7);
    ctx.stroke();

    // El humano lleva un aro blanco: entre dos discos del mismo color, este
    // dice cuál sos vos.
    if (yo) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 0.78, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Banderín de equipo ────────────────────────────────────────────────
  // Segunda señal, arriba del mago: un triángulo del color del bando. El
  // disco resuelve "de qué equipo es" cuando lo ves entero; esto lo resuelve
  // cuando el cuerpo está tapado por otro, porque asoma por encima del
  // montón. Dos señales en lugares opuestos = siempre queda una visible.
  _teamPennant(ctx, pl, world) {
    const b = pl.broom;
    const c = this._teamColors(pl);
    const yo = pl === world.playerA;
    const x = b.pos.x;
    const y = b.pos.y - 58 * S;
    const s = (yo ? 9 : 7) * S;

    ctx.save();
    ctx.globalAlpha = yo ? 0.95 : 0.8;
    // contorno
    ctx.fillStyle = 'rgba(12,8,24,0.85)';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 1.5);
    ctx.lineTo(x - s * 1.15, y - s * 0.5);
    ctx.lineTo(x + s * 1.15, y - s * 0.5);
    ctx.closePath();
    ctx.fill();
    // cuerpo
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 1.1);
    ctx.lineTo(x - s * 0.82, y - s * 0.35);
    ctx.lineTo(x + s * 0.82, y - s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Anillos de choque ─────────────────────────────────────────────────
  // Un aro que nace chico y brillante en el punto exacto del golpe y se
  // expande apagándose. Cuesta dos arc() y es de lo que más "peso" le da a
  // un impacto: sin él, un cañonazo contra la pared es igual a un roce.
  addShockRing(x, y, strength) {
    if (!this._rings) this._rings = [];
    if (this._rings.length > 8) this._rings.shift();
    this._rings.push({
      x, y, t: 0,
      life: 0.34,
      max: 26 + Math.min(strength / 22, 60),
    });
  }

  // Cartel del contragolpe encadenado. Sin esto la pelota se vuelve loca y el
  // jugador no sabe por qué: el aviso convierte un "bug" aparente en una
  // mecánica que se entiende al primer intento.
  chainToast(nivel) {
    this._chainToast = {
      t: 0,
      life: 1.1,
      texto: nivel >= 2 ? tr('toast.zigzag') : tr('toast.critical'),
      nivel,
    };
  }

  _chainToastDraw(ctx, W, H) {
    const c = this._chainToast;
    if (!c) return;
    c.t += this._dt || 0.016;
    if (c.t >= c.life) { this._chainToast = null; return; }
    const k = c.t / c.life;
    // Entra de golpe y se va desvaneciendo hacia arriba
    const alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
    const dy = -k * 34;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = 'center';
    ctx.font = 'bold 54px Georgia, serif';
    const col = c.nivel >= 2 ? '#ff5a10' : '#ffd76a';
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 26;
    // Bien arriba: el "¡YA!" y el "¡GOOOL!" viven en H*0.36-0.40 y se pisaban.
    ctx.fillText(c.texto, W / 2, H * 0.18 + dy);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _shockRings(ctx) {
    const rings = this._rings;
    if (!rings || !rings.length) return;
    const dt = this._dt || 1 / 60;
    ctx.save();
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { rings.splice(i, 1); continue; }
      // Radio con desaceleración: rápido al nacer, se frena al desvanecerse
      const rad = r.max * (1 - Math.pow(1 - k, 2.4));
      const a = (1 - k) * 0.75;
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#fff4d6';
      ctx.lineWidth = Math.max(0.6, 4.2 * (1 - k)) * S;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, 7);
      ctx.stroke();
      // Aro interior más tenue: da grosor sin costar otro path completo
      ctx.globalAlpha = a * 0.45;
      ctx.lineWidth = Math.max(0.5, 2 * (1 - k)) * S;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad * 0.62, 0, 7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Viñeta ────────────────────────────────────────────────────────────
  // El truco más barato que existe para que una imagen se vea compuesta:
  // oscurecer las esquinas empuja la mirada al centro, donde está el juego.
  // Va en espacio de PANTALLA (después de restore), no de mundo.
  _vignette(ctx, W, H) {
    const g = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.34,
      W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, 'rgba(6,4,16,0.22)');
    g.addColorStop(1, 'rgba(4,3,12,0.58)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _map(ctx) {
    const { imgW, imgH } = CFG.arena;
    if (this.mapReady) {
      ctx.drawImage(this.mapImg, -imgW / 2, -imgH / 2, imgW, imgH);
    } else {
      const g = ctx.createLinearGradient(0, -imgH / 2, 0, imgH / 2);
      g.addColorStop(0, '#0b0a24');
      g.addColorStop(1, '#2c1a4e');
      ctx.fillStyle = g;
      ctx.fillRect(-imgW / 2, -imgH / 2, imgW, imgH);
    }
  }

  // NOTA sobre el círculo de medio campo: está PINTADO EN LA PARED del mapa,
  // justo a la altura por la que vuela la pelota, y por eso a veces parece
  // que la pelota va a rebotar ahí. Verificado que NO hay colisionador: la
  // pelota lanzada por el centro sin jugadores pasa derecho, y los únicos
  // rebotes son piso (y=484) y techo. Probé atenuarlo por render (oscurecer
  // esa zona con 'multiply'): bajaba el contraste del arco un 53%, pero la
  // mancha se notaba y quedaba peor que el problema. Si algún día molesta de
  // verdad, hay que editar el PNG del mapa — no taparlo desde el código.

  // Los arcos rúnicos ya están pintados en la imagen: acá sólo se agrega el
  // aura de equipo, para que siga siendo obvio de un vistazo qué portal es
  // de quién sin repintar arte encima del arte.
  _portalAura(ctx, side, world) {
    const { portalR } = CFG.arena;
    const c = portalCenter(side);
    const color = side === -1 ? CFG.colors.p1 : CFG.colors.p2;
    const glow = side === -1 ? CFG.colors.p1Glow : CFG.colors.p2Glow;
    let pulse = 0.5 + 0.5 * Math.sin(this.t * 1.8 + side * 10);

    // El portal está vivo: se agita cuando la pelota se le acerca, y durante
    // un gol acumula energía antes de reventar.
    let charge = 0;
    if (world?.ball) {
      const d = Math.hypot(world.ball.pos.x - c.x, world.ball.pos.y - c.y);
      charge = clamp(1 - d / (portalR * 4), 0, 1);
    }
    const m = world?.match;
    const goaling = m && m.state === 'goal' && m.goalSide === side;
    if (goaling) {
      charge = m.blasted ? 1 : 1 - clamp(m.blastT / CFG.goalBlast.charge, 0, 1);
      pulse = 1;
    }
    const excite = Math.max(charge, goaling ? 1 : 0);

    ctx.save();
    ctx.translate(c.x, c.y);

    // Onda expansiva del gol: anillo que se abre y se disipa
    if (goaling && m.blasted && m.blastWave < 1) {
      const wv = m.blastWave;
      ctx.save();
      ctx.globalAlpha = (1 - wv) * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 26 * (1 - wv) + 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 40;
      ctx.beginPath();
      ctx.arc(0, 0, wv * CFG.goalBlast.radius, 0, 7);
      ctx.stroke();
      ctx.globalAlpha = (1 - wv) * 0.45;
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = 8 * (1 - wv) + 2;
      ctx.beginPath();
      ctx.arc(0, 0, wv * CFG.goalBlast.radius * 0.72, 0, 7);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // halo que respira, dentro del hueco del arco
    const haloR = portalR * (1.15 + excite * 0.9);
    const g = ctx.createRadialGradient(0, 0, portalR * 0.1, 0, 0, haloR);
    g.addColorStop(0, glow);
    g.addColorStop(0.55, glow.replace(/[\d.]+\)$/, '0.18)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (0.55 + pulse * 0.3) * (1 + excite * 0.6);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, haloR * 0.54, haloR, 0, 0, 7);
    ctx.fill();

    // borde luminoso siguiendo el óvalo del arco
    ctx.globalAlpha = 0.35 + pulse * 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5 + excite * 6;
    if (excite > 0.2) { ctx.shadowColor = color; ctx.shadowBlur = 14 * excite; }
    ctx.beginPath();
    ctx.ellipse(0, 0, portalR * 0.5, portalR * 0.94, 0, 0, 7);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // energía girando adentro: se acelera cuando la pelota se acerca
    const swirl = 1 + excite * 3.5;
    ctx.globalAlpha = 0.3 + excite * 0.45;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const a0 = this.t * swirl * (0.7 + i * 0.4) * side + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, portalR * (0.2 + i * 0.13), portalR * (0.36 + i * 0.24),
        0, a0, a0 + 2.4);
      ctx.stroke();
    }

    // ascuas subiendo por el hueco
    ctx.fillStyle = color;
    const embers = 5 + Math.round(excite * 9);
    for (let i = 0; i < embers; i++) {
      const ph = (this.t * (0.35 + excite * 1.2) + i / embers) % 1;
      const ey = portalR * 0.9 - ph * portalR * 1.8;
      const ex = Math.sin(this.t * 1.1 + i * 2.2) * portalR * 0.3;
      ctx.globalAlpha = (0.55 + excite * 0.35) * Math.sin(ph * Math.PI);
      ctx.beginPath();
      ctx.arc(ex, ey, 3.5 + excite * 2, 0, 7);
      ctx.fill();
    }

    // ── Portal SELLADO: reja + candado ──────────────────────────────────
    // Los primeros segundos de cada saque el arco rebota como pared. Sin una
    // señal visible el jugador tira, ve rebotar la pelota y cree que es un
    // bug. La reja dice "acá no se entra" y el candado lo confirma.
    const seal = this._portalSeal(world);
    if (seal > 0) {
      ctx.globalAlpha = 1;
      const R = portalR;
      // Se abre como una persiana en el último medio segundo: el jugador ve
      // venir la apertura y puede preparar el tiro.
      const k = Math.min(1, seal / 0.5);      // 1 = cerrado, 0 = abriendo
      const alpha = 0.30 + 0.45 * k;

      ctx.save();
      // Barrotes verticales, recortados al círculo del portal
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.96, 0, 7);
      ctx.clip();
      ctx.strokeStyle = `rgba(190,205,225,${alpha})`;
      ctx.lineWidth = 7 * S;
      ctx.lineCap = 'round';
      const nB = 5;
      for (let i = 0; i < nB; i++) {
        const x = -R * 0.62 + (i / (nB - 1)) * R * 1.24;
        const h = R * 0.94 * k;
        ctx.beginPath();
        ctx.moveTo(x, -h); ctx.lineTo(x, h);
        ctx.stroke();
      }
      // Dos travesaños
      ctx.lineWidth = 5.5 * S;
      for (const yy of [-R * 0.34, R * 0.34]) {
        ctx.beginPath();
        ctx.moveTo(-R * 0.9 * k, yy); ctx.lineTo(R * 0.9 * k, yy);
        ctx.stroke();
      }
      ctx.restore();

      // Candado en el centro, con un latido suave
      const pl = 1 + 0.06 * Math.sin(this.t * 5);
      ctx.save();
      ctx.translate(0, 0);
      ctx.scale(pl * k, pl * k);
      const bodyW = R * 0.42, bodyH = R * 0.34;
      // arco del candado
      ctx.strokeStyle = `rgba(235,242,255,${alpha + 0.2})`;
      ctx.lineWidth = 7 * S;
      ctx.beginPath();
      ctx.arc(0, -bodyH * 0.55, bodyW * 0.34, Math.PI, 0);
      ctx.stroke();
      // cuerpo
      ctx.fillStyle = `rgba(214,226,245,${alpha + 0.25})`;
      ctx.strokeStyle = `rgba(60,70,95,${alpha + 0.3})`;
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.roundRect(-bodyW / 2, -bodyH * 0.18, bodyW, bodyH, 6 * S);
      ctx.fill();
      ctx.stroke();
      // ojo de la cerradura
      ctx.fillStyle = `rgba(45,55,80,${alpha + 0.35})`;
      ctx.beginPath();
      ctx.arc(0, bodyH * 0.30, bodyW * 0.11, 0, 7);
      ctx.fill();
      ctx.fillRect(-bodyW * 0.045, bodyH * 0.30, bodyW * 0.09, bodyH * 0.30);
      ctx.restore();

      // Cuenta regresiva bajo el candado: saber CUÁNTO falta cambia la
      // decisión (esperar o seguir jugando la pelota).
      if (seal > 0.15) {
        ctx.globalAlpha = 0.85 * k;
        ctx.fillStyle = '#e8eefc';
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(R * 0.42)}px Georgia, serif`;
        ctx.fillText(String(Math.ceil(seal)), 0, R * 0.92);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Segundos que le quedan al sellado de los arcos (0 = abiertos).
  _portalSeal(world) {
    const m = world?.match;
    if (!m || m.state !== 'play') return 0;
    const t = m.playT ?? 99;
    return Math.max(0, CFG.match.goalSeal - t);
  }

  // ---------- ORBE FUGITIVO ----------
  // Dorado, más grande y con estela de cometa: tiene que gritar "vengan a
  // buscarme" desde el otro lado de la cancha. Cuanto más acosado, más
  // rápido late y más larga la estela.
  _runner(ctx, r) {
    const R = CFG.runner;

    // Aviso previo: un anillo que se cierra marcando dónde va a aparecer.
    // Sin esto se materializa de la nada y nadie llega a reaccionar.
    if (r.state === 'warn') {
      const k = 1 - clamp(r.timer / R.warn, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * k;
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 12]);
      ctx.beginPath();
      ctx.arc(r.x, r.y, R.r * (5 - 3.4 * k), 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5 * k;
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath(); ctx.arc(r.x, r.y, R.r * k, 0, 7); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    if (r.state !== 'alive') return;

    // Estela: se alarga con el pánico, así se lee la persecución
    for (let i = 1; i < r.trail.length; i++) {
      const t = i / r.trail.length;
      ctx.globalAlpha = t * (0.15 + 0.4 * r.panic);
      ctx.fillStyle = t > 0.7 ? '#fff6d8' : '#ffb020';
      ctx.beginPath();
      ctx.arc(r.trail[i].x, r.trail[i].y, R.r * t * 0.8, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Parpadeo de últimos segundos: avisa que se va a escapar
    const leaving = r.lifeT < 4;
    if (leaving && Math.sin(r.lifeT * 14) < -0.35) return;

    const beat = 1 + 0.09 * Math.sin(this.t * (5 + r.panic * 12));
    const rad = R.r * beat;

    ctx.save();
    ctx.translate(r.x, r.y);

    // halo dorado
    const g = ctx.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad * 3.2);
    g.addColorStop(0, 'rgba(255,225,140,0.75)');
    g.addColorStop(0.4, 'rgba(255,170,40,0.28)');
    g.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rad * 3.2, 0, 7); ctx.fill();

    // anillos rúnicos girando en sentidos opuestos
    ctx.strokeStyle = 'rgba(255,240,190,0.85)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 2; i++) {
      const a = this.t * (1.4 + i * 1.1) * (i ? -1 : 1);
      ctx.beginPath();
      ctx.ellipse(0, 0, rad * 1.9, rad * 0.7, a, 0, 7);
      ctx.stroke();
    }

    // núcleo
    const cg = ctx.createRadialGradient(-rad * 0.3, -rad * 0.3, rad * 0.15, 0, 0, rad);
    cg.addColorStop(0, '#fffdf0');
    cg.addColorStop(0.5, '#ffd76a');
    cg.addColorStop(1, '#e08a10');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, 7); ctx.fill();

    // símbolo de infinito: dice qué da, sin texto
    ctx.strokeStyle = '#7a4a08';
    ctx.lineWidth = rad * 0.13;
    const lr = rad * 0.34;
    ctx.beginPath();
    ctx.arc(-lr, 0, lr * 0.85, 0, 7);
    ctx.moveTo(lr + lr * 0.85, 0);
    ctx.arc(lr, 0, lr * 0.85, 0, 7);
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- ORBES ----------
  // Flotan, rotan, iluminan y sueltan chispas. Cuando están por volver se
  // materializan gradualmente, para poder anticipar el regreso.
  _orbs(ctx, field) {
    const O = CFG.orbs;
    for (const o of field.orbs) {
      const x = o.fx, y = o.fy;

      // Fantasma del respawn: marca dónde va a volver y cuánto falta
      if (!o.alive) {
        const left = o.respawnT / O.respawn;
        ctx.globalAlpha = 0.13;
        ctx.strokeStyle = '#9fe6ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, O.r * 1.5, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, O.r * 1.5, -Math.PI / 2, -Math.PI / 2 + (1 - left) * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      const f = o.fade;
      const r = O.r * (0.25 + 0.75 * f) * (1 + o.pop * 0.8);
      const spin = this.t * 1.7 + o.phase;

      ctx.save();
      ctx.globalAlpha = f;
      // halo
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3.4);
      g.addColorStop(0, 'rgba(150,235,255,0.55)');
      g.addColorStop(0.4, 'rgba(110,190,255,0.18)');
      g.addColorStop(1, 'rgba(90,160,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, 7); ctx.fill();

      // anillo rúnico girando
      ctx.strokeStyle = 'rgba(180,245,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 0.62, spin * 0.6, 0, 7);
      ctx.stroke();

      // núcleo
      const cg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.45, '#bdf0ff');
      cg.addColorStop(1, '#3fa8e8');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();

      // chispitas orbitando
      for (let i = 0; i < 3; i++) {
        const a = spin * 1.5 + i * 2.09;
        const rr = r * (1.9 + 0.35 * Math.sin(spin * 2 + i));
        ctx.fillStyle = 'rgba(220,250,255,0.9)';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55, 2, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- SOMBRAS ----------
  // Todo lo que vuela proyecta sombra sobre el césped: es la única pista
  // visual de "a qué altura estoy" en una vista lateral, y ancla a los
  // personajes al piso pintado en vez de dejarlos flotando pegados encima.
  _shadows(ctx, world) {
    for (const pl of (world.players || [world.playerA, world.playerB].filter(Boolean))) {
      const p = pl.rider.points;
      this._groundShadow(ctx, pl.broom.pos.x, pl.broom.pos.y, 62 * S);
      this._groundShadow(ctx, p.pelvis.x, p.pelvis.y, 26 * S);
    }
    this._groundShadow(ctx, world.ball.pos.x, world.ball.pos.y, world.ball.r * 1.05);
  }

  // Sombra de contacto: no es solo "una elipse más chica al subir". Cerca del
  // piso es CHICA, OSCURA y NÍTIDA (contacto duro); al alejarse se agranda,
  // se aclara y se difumina. Esa relación —tamaño inverso a la dureza— es lo
  // que el ojo lee como altura real, y es gratis: el degradado radial cuesta
  // lo mismo que el relleno plano que había antes.
  _groundShadow(ctx, x, y, baseR) {
    const { T, B } = CFG.arena;
    // 0 = tocando el césped, 1 = arriba del todo
    const h = clamp((B - y) / (B - T), 0, 1);
    const alpha = 0.55 * Math.pow(1 - h, 1.15);
    if (alpha < 0.012) return;
    const rx = baseR * (1 + h * 1.6);
    const ry = rx * 0.26;

    // El núcleo duro se encoge con la altura: a ras del piso la sombra es
    // casi toda núcleo; arriba, casi toda penumbra.
    const core = 1 - h * 0.75;
    const g = ctx.createRadialGradient(x, B, 0, x, B, Math.max(rx, 0.001));
    g.addColorStop(0, `rgba(10,6,22,${alpha})`);
    g.addColorStop(core * 0.55, `rgba(10,6,22,${alpha * 0.72})`);
    g.addColorStop(1, 'rgba(10,6,22,0)');

    ctx.save();
    ctx.translate(x, B);
    ctx.scale(1, ry / Math.max(rx, 0.001));
    ctx.translate(-x, -B);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, B, rx, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  // ---------- PERSONAJES ----------
  _player(ctx, player, color, dark, world) {
    const r = player.rider;
    // La previsualización de puntería es solo para el jugador humano
    const human = world && player === world.playerA && !world.botsMode;
    const p = r.points;
    const b = player.broom;

    // Estela del latigazo: el arco que barren los pies (detrás de todo)
    if (r.footTrail.length > 2) {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      for (let i = 1; i < r.footTrail.length; i++) {
        const t = i / r.footTrail.length;
        ctx.globalAlpha = t * 0.5;
        ctx.lineWidth = (2 + t * 7) * S;
        ctx.beginPath();
        ctx.moveTo(r.footTrail[i - 1].x, r.footTrail[i - 1].y);
        ctx.lineTo(r.footTrail[i].x, r.footTrail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Indicador de carga: sin esto el jugador no sabe que el golpe está listo
    const charge = r.chargeAmount();
    if (charge > 0) {
      const ready = r.isArmed();          // ya alcanza para disparar
      const full = charge >= 0.999;       // potencia máxima de carga
      // La energía disponible engrosa y tiñe el anillo: se ve que el golpe
      // va a salir más fuerte ANTES de soltarlo.
      const eFrac = clamp((player.energy || 0) / CFG.boost.max, 0, 1);
      // Con media reserva o más el golpe sale INFLAMADO: el anillo se vuelve
      // fuego para que se sepa antes de soltar, no después.
      const fire = eFrac >= CFG.whip.fireThreshold;
      const rOut = 74 * S, rIn = 64 * S;
      ctx.save();
      ctx.translate(b.pos.x, b.pos.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 3 * S;
      ctx.beginPath(); ctx.arc(0, 0, rOut, 0, 7); ctx.stroke();
      ctx.strokeStyle = fire ? '#ff7a24' : (full ? '#fff0b0' : (ready ? '#ffd76a' : color));
      ctx.globalAlpha = full ? 0.7 + 0.3 * Math.sin(this.t * 16) : (ready ? 0.85 : 0.45);
      ctx.lineWidth = (3.5 + charge * 4 + eFrac * 2.5) * S;
      if (full || fire) {
        ctx.shadowColor = fire ? '#ff7a24' : '#ffd76a';
        ctx.shadowBlur = fire ? 24 : 16;
      }
      ctx.beginPath();
      ctx.arc(0, 0, rOut, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // anillo interior: cuánta energía va a sumar la reserva al golpe
      if (eFrac > 0.02) {
        ctx.strokeStyle = fire ? '#ffb020' : '#9fe6ff';
        ctx.globalAlpha = 0.35 + eFrac * 0.4;
        ctx.lineWidth = 2.5 * S;
        ctx.beginPath();
        ctx.arc(0, 0, rIn, -Math.PI / 2, -Math.PI / 2 + eFrac * Math.PI * 2);
        ctx.stroke();
      }
      // Lenguas de fuego girando alrededor: el aviso de que esto va a doler
      if (fire) {
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.t * 12);
        ctx.fillStyle = '#ff8a2c';
        for (let i = 0; i < 6; i++) {
          const a = this.t * 2.4 + i * (Math.PI / 3);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rOut, Math.sin(a) * rOut, 4 * S, 0, 7);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Previsualización del golpe dirigido: si la pelota está en rango,
      // se muestra el rango y la línea hacia donde va a salir. Es lo que
      // hace que el jugador entienda que apunta con el mouse.
      if (ready && human) {
        const ball = world.ball;
        const shown = CFG.whip.range * CFG.whip.shownRange;
        const inRange = Math.hypot(ball.pos.x - b.pos.x, ball.pos.y - b.pos.y) <= shown;
        ctx.save();
        ctx.setLineDash([9, 11]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = inRange ? 'rgba(255,215,106,0.55)' : 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, shown, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
        if (inRange) {
          const aim = player.control.aim;
          let dx = aim.x - ball.pos.x, dy = aim.y - ball.pos.y;
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl; dy /= dl;
          ctx.strokeStyle = '#ffd76a';
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(ball.pos.x, ball.pos.y);
          ctx.lineTo(ball.pos.x + dx * 240, ball.pos.y + dy * 240);
          ctx.stroke();
          // punta de flecha
          ctx.beginPath();
          ctx.moveTo(ball.pos.x + dx * 240, ball.pos.y + dy * 240);
          ctx.lineTo(ball.pos.x + dx * 214 - dy * 15, ball.pos.y + dy * 214 + dx * 15);
          ctx.lineTo(ball.pos.x + dx * 214 + dy * 15, ball.pos.y + dy * 214 - dx * 15);
          ctx.closePath();
          ctx.fillStyle = '#ffd76a';
          ctx.fill();
          // resalte de la pelota como blanco válido
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 10);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(ball.pos.x, ball.pos.y, ball.r + 12, 0, 7);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // Skin de sprites: si el jugador cargó uno en /editor, se dibuja en lugar
    // del cuerpo geométrico. La escoba va en el medio del orden (entre el
    // cuerpo de atrás y el de adelante), por eso se pasa como callback.
    if (this.skin) {
      // El lado del espejo viene del ragdoll (freezeFlip ?? flipSide): es la
      // MISMA fuente que usa la física para espejar la pose, así el sprite y
      // el cuerpo nunca quedan en lados distintos (ni parpadean en vertical).
      const facing = player.rider
        ? (player.rider.freezeFlip ?? player.rider.flipSide ?? 1)
        : (Math.cos(b.angle) >= 0 ? 1 : -1);
      this.skin.draw(ctx, p, S, () => this._broom(ctx, b, player), facing);
      // Las manos van siempre encima: son el punto de agarre y tienen que
      // leerse pegadas al palo aunque el sprite del brazo no llegue justo.
      ctx.fillStyle = CFG.colors.skin;
      ctx.beginPath(); ctx.arc(p.handF.x, p.handF.y, 5.5 * S, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(p.handB.x, p.handB.y, 5 * S, 0, 7); ctx.fill();
      return;
    }

    // Datos vivos que el dibujo puede aprovechar: hacia qué lado mira el
    // cuerpo, hacia dónde vuela, y si viene de un golpazo. Ya los calcula la
    // física — usarlos acá no cuesta nada y el personaje deja de ser estático.
    const facing = r.freezeFlip ?? r.flipSide ?? 1;
    const look = { x: b.vel.x, y: b.vel.y };
    const slam = b.slamT > 0 ? (b.slamT / CFG.stuck.slamTime) : 0;

    // ── Skin vectorial (creado en /veditor.html) ─────────────────────────
    // Si está activado reemplaza al personaje del jugador humano. Va antes
    // del despacho de héroes: lo que el jugador construyó a mano gana.
    if (this.vskin && this.vskinOn && (!world || player === world.playerA)) {
      drawVSkin(ctx, this.vskin, p, b, S, { main: color, dark }, facing);
      this._fists(ctx, p);
      this._slamStars(ctx, p, slam);
      return;
    }

    // ── Despacho por personaje ────────────────────────────────────────────
    // Cada héroe dibuja su propio cuerpo y su propia escoba sobre estos
    // mismos puntos del ragdoll: la física no sabe qué personaje la viste.
    const hero = CHARACTERS[player.characterId];
    if (hero) {
      hero.draw(ctx, this, player, color, dark, world, { facing, look, slam });
      this._slamStars(ctx, p, slam);
      return;
    }

    // Capa (detrás de todo): borde ondulado, degradado y forro interior.
    // El ancho de cada tramo se afina hacia la punta, y el borde inferior
    // ondula con el tiempo para que la tela se vea flameando y no rígida.
    const cape = r.cape;
    const capePath = (wob) => {
      ctx.beginPath();
      ctx.moveTo(cape[0].x, cape[0].y);
      for (let i = 1; i < cape.length; i++) {
        const w = (12 - i * 1.5) * S;
        const f = wob ? Math.sin(this.t * 7 + i * 1.1) * i * 0.5 * S : 0;
        ctx.lineTo(cape[i].x, cape[i].y + w + f);
      }
      for (let i = cape.length - 1; i >= 0; i--) {
        const w = (12 - i * 1.5) * S;
        const f = wob ? Math.sin(this.t * 7 + i * 1.1 + 2) * i * 0.5 * S : 0;
        ctx.lineTo(cape[i].x, cape[i].y - w + f);
      }
      ctx.closePath();
    };
    capePath(true);
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = 3 * S;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const gc = ctx.createLinearGradient(cape[0].x, cape[0].y,
                                        cape[cape.length - 1].x, cape[cape.length - 1].y);
    gc.addColorStop(0, this._shade(dark, 22));
    gc.addColorStop(1, this._shade(dark, -30));
    capePath(true);
    ctx.fillStyle = gc;
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    // Forro: una franja central más clara sugiere el interior de la capa
    ctx.strokeStyle = this._shade(dark, 34);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3.4 * S;
    ctx.beginPath();
    ctx.moveTo(cape[0].x, cape[0].y);
    for (let i = 1; i < cape.length; i++) ctx.lineTo(cape[i].x, cape[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Pierna trasera (más oscura → profundidad)
    this._limb(ctx, p.pelvis, p.kneeB, p.footB, 9 * S, this._shade(dark, -15));
    // Brazo trasero
    this._limbSeg(ctx, p.chest, p.handB, 8 * S, this._shade(dark, -10));

    // Escoba
    this._broom(ctx, b, player);

    // Pierna delantera
    this._limb(ctx, p.pelvis, p.kneeF, p.footF, 10 * S, dark);

    // Torso (túnica)
    this._torso(ctx, p.pelvis, p.chest, color, dark);

    // Brazo delantero
    this._limbSeg(ctx, p.chest, p.handF, 9 * S, color);

    // Manos (siempre en el palo): con contorno y un reflejo, para que se
    // lean como puños cerrados agarrando y no como bolitas sueltas.
    for (const [h, rad] of [[p.handF, 5.8], [p.handB, 5.2]]) {
      ctx.fillStyle = this._ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * S + 1.4 * S, 0, 7); ctx.fill();
      ctx.fillStyle = CFG.colors.skin;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * S, 0, 7); ctx.fill();
      ctx.fillStyle = this._shade(CFG.colors.skin, 26);
      ctx.beginPath(); ctx.arc(h.x - 1.4 * S, h.y - 1.6 * S, rad * 0.42 * S, 0, 7); ctx.fill();
    }

    // Cabeza + sombrero (mirando hacia donde vuela)
    this._head(ctx, p.head, p.chest, color, dark, facing, look, slam);

    this._slamStars(ctx, p, slam);
  }

  // ── Estela fantasma del dash ──────────────────────────────────────────
  // Siluetas simplificadas del mago en posiciones de hace unos frames.
  // No re-dibuja al héroe completo: un esqueleto de trazos del color del
  // equipo, desvaneciéndose, lee "velocidad" a una fracción del costo.
  _ghostTrail(ctx, world) {
    const gs = world.ghosts;
    if (!gs || !gs.length) return;
    const col = this._teamColors(world.playerA).main;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const g of gs) {
      const p = g.pts;
      if (!p.pelvis) continue;
      ctx.globalAlpha = Math.max(0, (g.life / g.max)) * 0.32;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      // torso
      ctx.lineWidth = 11 * S;
      ctx.beginPath();
      ctx.moveTo(p.pelvis.x, p.pelvis.y); ctx.lineTo(p.chest.x, p.chest.y);
      ctx.stroke();
      // piernas
      ctx.lineWidth = 7 * S;
      ctx.beginPath();
      ctx.moveTo(p.pelvis.x, p.pelvis.y); ctx.lineTo(p.kneeF.x, p.kneeF.y); ctx.lineTo(p.footF.x, p.footF.y);
      ctx.moveTo(p.pelvis.x, p.pelvis.y); ctx.lineTo(p.kneeB.x, p.kneeB.y); ctx.lineTo(p.footB.x, p.footB.y);
      ctx.stroke();
      // brazos
      ctx.lineWidth = 6 * S;
      ctx.beginPath();
      ctx.moveTo(p.chest.x, p.chest.y); ctx.lineTo(p.handF.x, p.handF.y);
      ctx.moveTo(p.chest.x, p.chest.y); ctx.lineTo(p.handB.x, p.handB.y);
      ctx.stroke();
      // cabeza
      ctx.beginPath();
      ctx.arc(p.head.x, p.head.y, 9 * S, 0, 7);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Confetti de victoria ──────────────────────────────────────────────
  // Papelitos en espacio de PANTALLA (no de mundo): caen sobre el cartel de
  // victoria. Se generan al entrar a la pantalla de fin y se reciclan por
  // arriba mientras dure — la celebración no se agota si el jugador se queda
  // mirando sus récords.
  _confetti(ctx, world, W, H) {
    if (!this.confetti) {
      this.confetti = [];
      const cols = ['#ffd76a', '#3fc0ff', '#ffffff', '#7ee8a2', '#ff9d6b'];
      for (let i = 0; i < 130; i++) {
        this.confetti.push({
          x: Math.random() * W,
          y: -Math.random() * H,              // entran escalonados desde arriba
          vy: 90 + Math.random() * 160,
          sway: 20 + Math.random() * 46,      // vaivén lateral
          ph: Math.random() * 7,
          rot: Math.random() * 7,
          vr: (Math.random() * 2 - 1) * 4,
          w: 5 + Math.random() * 7,
          h: 3 + Math.random() * 5,
          col: cols[(Math.random() * cols.length) | 0],
        });
      }
    }
    const dt = this._dt || 1 / 60;
    ctx.save();
    for (const c of this.confetti) {
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      if (c.y > H + 20) { c.y = -20; c.x = Math.random() * W; }
      const x = c.x + Math.sin(this.t * 2.2 + c.ph) * c.sway;
      ctx.save();
      ctx.translate(x, c.y);
      ctx.rotate(c.rot);
      // El "giro 3D" barato: el alto oscila con el tiempo, como si el papel
      // rotara sobre su eje. Vende volumen sin más geometría.
      const hh = c.h * Math.abs(Math.sin(this.t * 3 + c.ph));
      ctx.fillStyle = c.col;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-c.w / 2, -hh / 2, c.w, Math.max(1.2, hh));
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Aviso de desafío completado ───────────────────────────────────────
  // Banner bajo el marcador. De a uno por vez: si se completan dos juntos,
  // el segundo espera su turno en la cola del world.
  _challengeToast(ctx, world, W) {
    if (!this._chT && world.challengeQueue?.length) {
      this._ch = world.challengeQueue.shift();
      this._chT = this.t + 4.6;
    }
    if (!this._chT) return;
    if (this.t > this._chT) { this._chT = 0; this._ch = null; return; }

    const c = this._ch;
    const fade = Math.min(1, (this._chT - this.t) / 0.5, (this.t - (this._chT - 4.6)) * 3);
    const cx = W / 2, y = 92;
    const texto = tr('toast.challenge', { icon: c.icono, title: tr(`ch.${c.id}.title`) });
    const sub = c.palette ? tr('toast.palette', { name: tr(`pal.${c.palette.id}.name`) }) : tr('toast.medal');

    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.textAlign = 'center';
    const w = 460, h = 58;
    ctx.fillStyle = 'rgba(20,16,44,0.92)';
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, y, w, h, 12);
    ctx.fill();
    ctx.shadowColor = '#ffd76a';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 18px Georgia, serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(texto, cx, y + 24);
    ctx.font = '13px Georgia, serif';
    ctx.fillStyle = 'rgba(232,236,255,0.85)';
    ctx.fillText(sub, cx, y + 44);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Estrellitas de aturdimiento girando sobre la cabeza tras un golpazo.
  // Genérico: lo comparten el mago, los héroes y el skin vectorial.
  _slamStars(ctx, p, slam) {
    if (slam <= 0.05) return;
    ctx.save();
    ctx.translate(p.head.x, p.head.y - 34 * S);
    ctx.globalAlpha = Math.min(1, slam * 1.4);
    ctx.fillStyle = '#ffe57a';
    for (let i = 0; i < 3; i++) {
      const a = this.t * 7 + i * (Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 15 * S, Math.sin(a) * 5 * S, 2.6 * S, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Puños genéricos sobre los agarres, con contorno y reflejo. Los usa el
  // skin vectorial (y quien no quiera dibujar manos propias).
  _fists(ctx, p) {
    for (const [h, rad] of [[p.handF, 5.8], [p.handB, 5.2]]) {
      ctx.fillStyle = this._ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * S + 1.4 * S, 0, 7); ctx.fill();
      ctx.fillStyle = CFG.colors.skin;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad * S, 0, 7); ctx.fill();
      ctx.fillStyle = this._shade(CFG.colors.skin, 26);
      ctx.beginPath(); ctx.arc(h.x - 1.4 * S, h.y - 1.6 * S, rad * 0.42 * S, 0, 7); ctx.fill();
    }
  }

  // Colores por equipo. En 2v2 el compañero usa una variante más clara del
  // mismo color: se distingue de vos sin que se confunda con el rival.
  _teamColors(pl) {
    if (!pl) return { main: CFG.colors.p1, dark: CFG.colors.p1Dark };
    const p1 = pl.team === 'p1';
    const main = p1 ? CFG.colors.p1 : CFG.colors.p2;
    const dark = p1 ? CFG.colors.p1Dark : CFG.colors.p2Dark;
    if (!pl.index) return { main, dark };
    return { main: this._shade(main, 46), dark: this._shade(dark, 34) };
  }

  // Marca sobre el jugador humano: con cuatro magos en pantalla hay que
  // poder encontrarse de un vistazo.
  // Anillo pulsante DEBAJO de tu mago. Chico y bien rasante (0.30) a
  // propósito: rodeando el cuerpo competía con el skin y ensuciaba la lectura;
  // corrido hacia abajo se lee como la sombra proyectada del mago y el ojo lo
  // encuentra sin que tape nada. Dos trazos —uno ancho y tenue, uno fino y
  // brillante— porque un solo trazo o se pierde sobre el césped claro o pesa
  // demasiado sobre el cielo oscuro.
  _selfHalo(ctx, pl, color) {
    const x = pl.broom.pos.x, y = pl.broom.pos.y + 30 * S;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.6);
    const r = (34 + pulse * 3) * S;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.30);

    ctx.globalAlpha = 0.16 + pulse * 0.08;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8 * S;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.stroke();

    ctx.globalAlpha = 0.55 + pulse * 0.2;
    ctx.lineWidth = 2.4 * S;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _selfMarker(ctx, pl, color) {
    const y = pl.broom.pos.y - 96 * S - Math.sin(this.t * 3) * 5;
    const x = pl.broom.pos.x;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + 16 * S);
    ctx.lineTo(x - 11 * S, y);
    ctx.lineTo(x + 11 * S, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,8,25,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _shade(hex, amt) {
    // oscurecer/aclarar un color hex simple
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // Contorno oscuro que envuelve toda la silueta. Es el detalle que más
  // cambia la lectura del personaje: el mapa es un castillo con antorchas y
  // mucho ruido de color, y sin una línea que separe al mago del fondo la
  // figura se disuelve a la distancia de juego. Se dibuja como un trazo más
  // ancho DEBAJO del color, así que no hace falta calcular la silueta real.
  get _ink() { return 'rgba(16,12,28,0.92)'; }

  // Miembro de dos tramos (muslo + pantorrilla, u hombro + antebrazo) con
  // grosor decreciente: ancho en la articulación de origen, fino en la punta.
  // Un trazo de grosor uniforme se lee como un fideo; la conicidad es lo que
  // da anatomía sin costar un sprite.
  _limb(ctx, a, m, b, w, color) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1) Contorno
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = w + 3.2 * S;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // 2) Tramo grueso (a→m) y fino (m→b): el muslo es más ancho que la
    //    pantorrilla, y eso solo se puede hacer en dos trazos separados.
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.stroke();
    ctx.lineWidth = w * 0.76;
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // 3) Luz superior: una línea fina y clara sobre el borde de arriba de
    //    cada tramo simula que la luz viene del cielo, y despega el volumen.
    ctx.strokeStyle = this._shade(color, 40);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, w * 0.22);
    const off = (p, q, k) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      return { nx: -dy / d * k, ny: dx / d * k };
    };
    const o1 = off(a, m, w * 0.3);
    ctx.beginPath();
    ctx.moveTo(a.x + o1.nx, a.y + o1.ny);
    ctx.lineTo(m.x + o1.nx, m.y + o1.ny);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 4) Bota: cápsula orientada según el último tramo, con puntera y caña.
    //    Un círculo se leía como una pelotita pegada al tobillo.
    const dx = b.x - m.x, dy = b.y - m.y;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang);
    ctx.fillStyle = this._ink;
    ctx.beginPath();
    ctx.ellipse(w * 0.12, 0, w * 0.85, w * 0.62, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#3a3048';
    ctx.beginPath();
    ctx.ellipse(w * 0.06, -w * 0.1, w * 0.66, w * 0.44, 0, 0, 7);
    ctx.fill();
    // hebilla
    ctx.fillStyle = '#c9a04e';
    ctx.fillRect(-w * 0.1, -w * 0.34, w * 0.3, w * 0.16);
    ctx.restore();
  }

  // Miembro de un solo tramo (brazo). Mismo tratamiento: contorno, cuerpo
  // cónico y luz superior.
  _limbSeg(ctx, a, b, w, color) {
    ctx.lineCap = 'round';

    ctx.strokeStyle = this._ink;
    ctx.lineWidth = w + 3.2 * S;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // Cónico: se dibuja en dos mitades porque canvas no da grosor variable.
    const mx = lerp(a.x, b.x, 0.55), my = lerp(a.y, b.y, 0.55);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mx, my); ctx.stroke();
    ctx.lineWidth = w * 0.74;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(b.x, b.y); ctx.stroke();

    // Puño de la manga, donde termina la tela y empieza la mano
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const cx = b.x - dx / d * w * 0.55, cy = b.y - dy / d * w * 0.55;
    ctx.strokeStyle = this._shade(color, -34);
    ctx.lineWidth = w * 0.82;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(b.x - dx / d * w * 0.2, b.y - dy / d * w * 0.2);
    ctx.stroke();
  }

  // Túnica del mago. Antes era un trapecio de color plano; ahora tiene
  // contorno, degradado transversal (luz de un lado, sombra del otro),
  // pliegues verticales, cuello en V, cinturón con hebilla y un emblema del
  // equipo en el pecho. Todo se construye sobre el eje pelvis→pecho, así que
  // acompaña al ragdoll sin lógica extra.
  _torso(ctx, pelvis, chest, color, dark) {
    const dx = chest.x - pelvis.x, dy = chest.y - pelvis.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;          // eje del torso (pelvis→pecho)
    const nx = -uy, ny = ux;                 // perpendicular

    const HW_CHEST = 10.5 * S;               // medio ancho a la altura del pecho
    const HW_HIP = 16 * S;                   // faldón acampanado
    const P = (alongFrac, side, extra = 0) => {
      const bx = lerp(pelvis.x, chest.x, alongFrac);
      const by = lerp(pelvis.y, chest.y, alongFrac);
      const hw = lerp(HW_HIP, HW_CHEST, alongFrac) + extra;
      return { x: bx + nx * hw * side, y: by + ny * hw * side };
    };

    // Silueta de la túnica, con el bajo del faldón ligeramente abierto
    const outline = () => {
      const a = P(1, 1), b = P(1, -1);
      const c = P(0, -1, 2 * S), e = P(0, 1, 2 * S);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      // borde inferior con una leve curva: la tela cuelga, no corta recto
      const midLow = { x: lerp(c.x, e.x, 0.5) - ux * 3 * S,
                       y: lerp(c.y, e.y, 0.5) - uy * 3 * S };
      ctx.quadraticCurveTo(midLow.x, midLow.y, e.x, e.y);
      ctx.closePath();
    };

    // 1) Contorno
    outline();
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = 3.4 * S;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 2) Relleno con degradado perpendicular al torso: un lado recibe luz,
    //    el otro queda en sombra. Es lo que le da cilindro al cuerpo.
    const g = ctx.createLinearGradient(
      chest.x + nx * HW_CHEST, chest.y + ny * HW_CHEST,
      chest.x - nx * HW_CHEST, chest.y - ny * HW_CHEST,
    );
    g.addColorStop(0, this._shade(color, 30));
    g.addColorStop(0.55, color);
    g.addColorStop(1, this._shade(color, -42));
    outline();
    ctx.fillStyle = g;
    ctx.fill();

    // 3) Pliegues del faldón: tres líneas suaves que nacen del cinturón y
    //    caen hasta el borde. Sin esto la túnica se lee como cartón.
    ctx.strokeStyle = this._shade(color, -55);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.6 * S;
    for (const s of [-0.55, 0, 0.55]) {
      const top = P(0.42, s);
      const bot = P(0.02, s * 1.15);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 4) Cuello en V, en el tono oscuro del equipo
    const nA = P(0.95, 0.5), nB = P(0.95, -0.5);
    const nC = { x: lerp(pelvis.x, chest.x, 0.72), y: lerp(pelvis.y, chest.y, 0.72) };
    ctx.beginPath();
    ctx.moveTo(nA.x, nA.y);
    ctx.lineTo(nC.x, nC.y);
    ctx.lineTo(nB.x, nB.y);
    ctx.closePath();
    ctx.fillStyle = this._shade(dark, -10);
    ctx.fill();

    // 5) Cinturón + hebilla dorada
    const bx = lerp(pelvis.x, chest.x, 0.3), by = lerp(pelvis.y, chest.y, 0.3);
    const bhw = lerp(HW_HIP, HW_CHEST, 0.3) + 1.5 * S;
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = 6.4 * S;
    ctx.beginPath();
    ctx.moveTo(bx + nx * bhw, by + ny * bhw);
    ctx.lineTo(bx - nx * bhw, by - ny * bhw);
    ctx.stroke();
    ctx.strokeStyle = '#4a3b2a';
    ctx.lineWidth = 4.6 * S;
    ctx.beginPath();
    ctx.moveTo(bx + nx * bhw, by + ny * bhw);
    ctx.lineTo(bx - nx * bhw, by - ny * bhw);
    ctx.stroke();
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = '#e8c25a';
    ctx.fillRect(-3.2 * S, -3.6 * S, 6.4 * S, 7.2 * S);
    ctx.fillStyle = '#8a6c22';
    ctx.fillRect(-1.4 * S, -1.6 * S, 2.8 * S, 3.2 * S);
    ctx.restore();

    // 6) Emblema en el pecho: rombo claro del color del equipo. Ayuda a
    //    identificar de qué lado es cada mago en un revoltijo.
    const ex = lerp(pelvis.x, chest.x, 0.66), ey = lerp(pelvis.y, chest.y, 0.66);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = this._shade(color, 62);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(4.4 * S, 0); ctx.lineTo(0, 3.4 * S);
    ctx.lineTo(-4.4 * S, 0); ctx.lineTo(0, -3.4 * S);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Cabeza del mago. `facing` (+1/−1) dice hacia qué lado mira, y `look` es
  // la dirección de vuelo: con eso los ojos siguen el rumbo en vez de quedar
  // fijos. Los ojos son el detalle más barato del personaje y el que más
  // hace por él — de golpe hay alguien ahí adentro y no un muñeco.
  _head(ctx, head, chest, color, dark, facing = 1, look = null, slam = 0) {
    // orientación: vector pecho→cabeza = "arriba" del personaje
    let ux = head.x - chest.x, uy = head.y - chest.y;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    const px = -uy, py = ux; // perpendicular
    const R = 11 * S;
    // Hacia adelante en el plano de la cara (el lado al que mira)
    const fx = px * facing, fy = py * facing;

    // 1) Contorno de la cabeza
    ctx.fillStyle = this._ink;
    ctx.beginPath(); ctx.arc(head.x, head.y, R + 1.6 * S, 0, 7); ctx.fill();

    // 2) Cara con degradado: iluminada arriba, en sombra bajo el ala
    const gf = ctx.createLinearGradient(
      head.x + ux * R, head.y + uy * R,
      head.x - ux * R, head.y - uy * R,
    );
    gf.addColorStop(0, this._shade(CFG.colors.skin, 18));
    gf.addColorStop(1, this._shade(CFG.colors.skin, -30));
    ctx.fillStyle = gf;
    ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, 7); ctx.fill();

    // 3) Oreja del lado visible
    ctx.fillStyle = this._shade(CFG.colors.skin, -18);
    ctx.beginPath();
    ctx.arc(head.x - fx * R * 0.82, head.y - fy * R * 0.82, R * 0.26, 0, 7);
    ctx.fill();

    // 4) Ojos: dos puntos corridos hacia el frente, con el iris desplazado
    //    hacia el rumbo de vuelo. Aturdido (slam) se dibujan como cruces.
    const eyeBase = { x: head.x + fx * R * 0.34 + ux * R * 0.12,
                      y: head.y + fy * R * 0.34 + uy * R * 0.12 };
    const sep = R * 0.30;
    const eyes = [
      { x: eyeBase.x + ux * sep * 0.55 + fx * sep * 0.28,
        y: eyeBase.y + uy * sep * 0.55 + fy * sep * 0.28 },
      { x: eyeBase.x - ux * sep * 0.55 + fx * sep * 0.28,
        y: eyeBase.y - uy * sep * 0.55 + fy * sep * 0.28 },
    ];
    if (slam > 0.05) {
      // Aturdido: los ojos se vuelven cruces. Lee al instante que se golpeó.
      ctx.strokeStyle = '#2a2136';
      ctx.lineWidth = 1.5 * S;
      for (const e of eyes) {
        const s = R * 0.2;
        ctx.beginPath();
        ctx.moveTo(e.x - s, e.y - s); ctx.lineTo(e.x + s, e.y + s);
        ctx.moveTo(e.x + s, e.y - s); ctx.lineTo(e.x - s, e.y + s);
        ctx.stroke();
      }
    } else {
      // Iris corrido hacia donde vuela: mirada viva sin animación extra.
      let lx = 0, ly = 0;
      if (look) {
        const ll = Math.hypot(look.x, look.y) || 1;
        lx = (look.x / ll) * R * 0.12;
        ly = (look.y / ll) * R * 0.12;
      }
      ctx.fillStyle = '#fbf7ef';
      for (const e of eyes) {
        ctx.beginPath(); ctx.arc(e.x, e.y, R * 0.20, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#241d33';
      for (const e of eyes) {
        ctx.beginPath(); ctx.arc(e.x + lx, e.y + ly, R * 0.105, 0, 7); ctx.fill();
      }
    }

    // 5) Cejas pobladas de mago viejo, justo sobre los ojos
    ctx.strokeStyle = '#e6e0d2';
    ctx.lineWidth = 2.1 * S;
    ctx.lineCap = 'round';
    for (const e of eyes) {
      const bx0 = e.x + ux * R * 0.30 - fx * R * 0.10;
      const by0 = e.y + uy * R * 0.30 - fy * R * 0.10;
      ctx.beginPath();
      ctx.moveTo(bx0, by0);
      ctx.lineTo(bx0 + fx * R * 0.34, by0 + fy * R * 0.34 + uy * R * 0.04);
      ctx.stroke();
    }

    // 6) Barba: tres lóbulos superpuestos en vez de un círculo, con sombra.
    //    Cuelga hacia "abajo" del personaje y se abre hacia el frente.
    const beard = (r, alongF, sideF, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(head.x - ux * R * alongF + fx * R * sideF,
              head.y - uy * R * alongF + fy * R * sideF, r, 0, 7);
      ctx.fill();
    };
    beard(R * 0.62, 0.62, 0.10, this._ink);
    beard(R * 0.56, 0.60, 0.12, '#e9e3d5');
    beard(R * 0.40, 0.95, 0.02, '#dcd5c4');
    beard(R * 0.30, 1.22, -0.06, '#cfc7b4');
    // bigote
    ctx.fillStyle = '#efe9dc';
    ctx.beginPath();
    ctx.ellipse(head.x - ux * R * 0.22 + fx * R * 0.44,
                head.y - uy * R * 0.22 + fy * R * 0.44,
                R * 0.30, R * 0.17, Math.atan2(fy, fx), 0, 7);
    ctx.fill();

    // 7) Sombrero: ala elíptica con contorno, cono curvado que cae hacia
    //    atrás, banda y hebilla. La punta se dobla: un cono recto se ve
    //    rígido, y este mago vuela.
    const brimA = Math.atan2(py, px);
    ctx.fillStyle = this._ink;
    ctx.beginPath();
    ctx.ellipse(head.x + ux * 7 * S, head.y + uy * 7 * S, 17.4 * S, 6.2 * S, brimA, 0, 7);
    ctx.fill();
    ctx.fillStyle = this._shade(dark, -6);
    ctx.beginPath();
    ctx.ellipse(head.x + ux * 7 * S, head.y + uy * 7 * S, 16 * S, 5 * S, brimA, 0, 7);
    ctx.fill();

    // Cono con curva: base ancha, punta desviada hacia atrás y hacia el lado
    const baseL = { x: head.x + (ux * 8 + px * 10) * S, y: head.y + (uy * 8 + py * 10) * S };
    const baseR = { x: head.x + (ux * 8 - px * 10) * S, y: head.y + (uy * 8 - py * 10) * S };
    const tipHat = { x: head.x + (ux * 31 - fx * 13) * S, y: head.y + (uy * 31 - fy * 13) * S };
    const ctrl   = { x: head.x + (ux * 20 - fx * 2) * S,  y: head.y + (uy * 20 - fy * 2) * S };
    const hatPath = () => {
      ctx.beginPath();
      ctx.moveTo(baseL.x, baseL.y);
      ctx.lineTo(baseR.x, baseR.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, tipHat.x, tipHat.y);
      ctx.quadraticCurveTo(ctrl.x + fx * 6 * S, ctrl.y + fy * 6 * S, baseL.x, baseL.y);
      ctx.closePath();
    };
    hatPath();
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = 2.6 * S;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const gh = ctx.createLinearGradient(baseL.x, baseL.y, baseR.x, baseR.y);
    gh.addColorStop(0, this._shade(color, 26));
    gh.addColorStop(1, this._shade(color, -34));
    hatPath();
    ctx.fillStyle = gh;
    ctx.fill();

    // Banda + hebilla del sombrero
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = 4.6 * S;
    ctx.beginPath();
    ctx.moveTo(head.x + (ux * 9 + px * 9.4) * S, head.y + (uy * 9 + py * 9.4) * S);
    ctx.lineTo(head.x + (ux * 9 - px * 9.4) * S, head.y + (uy * 9 - py * 9.4) * S);
    ctx.stroke();
    ctx.strokeStyle = this._shade(dark, -22);
    ctx.lineWidth = 3.2 * S;
    ctx.beginPath();
    ctx.moveTo(head.x + (ux * 9 + px * 9.4) * S, head.y + (uy * 9 + py * 9.4) * S);
    ctx.lineTo(head.x + (ux * 9 - px * 9.4) * S, head.y + (uy * 9 - py * 9.4) * S);
    ctx.stroke();
    ctx.save();
    ctx.translate(head.x + (ux * 9 + fx * 3) * S, head.y + (uy * 9 + fy * 3) * S);
    ctx.rotate(brimA);
    ctx.fillStyle = '#e8c25a';
    ctx.fillRect(-2.4 * S, -2.4 * S, 4.8 * S, 4.8 * S);
    ctx.restore();

    // 8) Estrellita en el sombrero: guiño mágico, y ayuda a leer la rotación
    const starX = head.x + (ux * 19 - fx * 4) * S;
    const starY = head.y + (uy * 19 - fy * 4) * S;
    ctx.fillStyle = 'rgba(255,240,180,0.9)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = brimA + i * Math.PI / 4;
      const rr = (i % 2 ? 1.1 : 2.8) * S;
      const X = starX + Math.cos(a) * rr, Y = starY + Math.sin(a) * rr;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
  }

  _broom(ctx, b, player) {
    const tip = b.tip(), tail = b.tail();
    const d = b.dir();

    // Skin de escoba hecho en /editor: solo para el jugador humano (p1).
    // Los efectos (resplandor, runas) siguen siendo procedurales.
    if (this.broomSkin && player?.team === 'p1') {
      // Mismo lado que el cuerpo: mirando a la izquierda la escoba se dibuja
      // como espejo (no boca abajo). Durante el giro de 360° el lado queda
      // congelado (freezeFlip) y la escoba rota continua, sin saltos.
      const facing = player.rider
        ? (player.rider.freezeFlip ?? player.rider.flipSide ?? 1)
        : 1;
      this.broomSkin.draw(ctx, b, S, facing);
      this._broomFX(ctx, b, tip, tail, d);
      return;
    }

    // ── Escoba con volumen ────────────────────────────────────────────────
    // El palo dejó de ser una línea plana: contorno, degradado a lo largo,
    // veta de la madera, empuñadura de cuero con anillos metálicos y una
    // punta rúnica. Se construye sobre el eje cola→punta, así que rota con
    // la física sin cálculos extra.
    const nx = -d.y, ny = d.x;                       // perpendicular al palo
    const bx0 = tail.x + d.x * 14 * S, by0 = tail.y + d.y * 14 * S;

    // Contorno del palo
    ctx.lineCap = 'round';
    ctx.strokeStyle = this._ink;
    ctx.lineWidth = 10 * S;
    ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.lineTo(tip.x, tip.y); ctx.stroke();

    // Cuerpo con degradado longitudinal (más claro cerca de la punta)
    const gw = ctx.createLinearGradient(bx0, by0, tip.x, tip.y);
    gw.addColorStop(0, CFG.colors.woodDark);
    gw.addColorStop(0.5, CFG.colors.wood);
    gw.addColorStop(1, this._shade(CFG.colors.wood, 24));
    ctx.strokeStyle = gw;
    ctx.lineWidth = 7 * S;
    ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.lineTo(tip.x, tip.y); ctx.stroke();

    // Brillo especular en el borde superior: el palo se ve redondo
    ctx.strokeStyle = this._shade(CFG.colors.wood, 58);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.8 * S;
    ctx.beginPath();
    ctx.moveTo(bx0 + nx * 1.9 * S, by0 + ny * 1.9 * S);
    ctx.lineTo(tip.x + nx * 1.9 * S, tip.y + ny * 1.9 * S);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Veta de la madera: tres marcas cortas repartidas a lo largo
    ctx.strokeStyle = CFG.colors.woodDark;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.1 * S;
    for (const f of [0.32, 0.55, 0.78]) {
      const vx = lerp(bx0, tip.x, f), vy = lerp(by0, tip.y, f);
      ctx.beginPath();
      ctx.moveTo(vx - d.x * 4 * S + nx * 0.8 * S, vy - d.y * 4 * S + ny * 0.8 * S);
      ctx.lineTo(vx + d.x * 4 * S - nx * 0.8 * S, vy + d.y * 4 * S - ny * 0.8 * S);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Empuñadura de cuero donde van las manos, con dos anillos metálicos
    const gripA = 0.30, gripB = 0.56;
    const gax = lerp(bx0, tip.x, gripA), gay = lerp(by0, tip.y, gripA);
    const gbx = lerp(bx0, tip.x, gripB), gby = lerp(by0, tip.y, gripB);
    ctx.strokeStyle = '#4a3524';
    ctx.lineWidth = 8 * S;
    ctx.beginPath(); ctx.moveTo(gax, gay); ctx.lineTo(gbx, gby); ctx.stroke();
    // trenzado del cuero
    ctx.strokeStyle = '#31210f';
    ctx.lineWidth = 1 * S;
    for (let i = 0; i <= 6; i++) {
      const f = gripA + (gripB - gripA) * (i / 6);
      const hx = lerp(bx0, tip.x, f), hy = lerp(by0, tip.y, f);
      ctx.beginPath();
      ctx.moveTo(hx + nx * 3.6 * S, hy + ny * 3.6 * S);
      ctx.lineTo(hx - nx * 3.6 * S - d.x * 2 * S, hy - ny * 3.6 * S - d.y * 2 * S);
      ctx.stroke();
    }
    // anillos dorados en los extremos del agarre
    ctx.strokeStyle = '#c9a04e';
    ctx.lineWidth = 9 * S;
    for (const [rx, ry] of [[gax, gay], [gbx, gby]]) {
      ctx.beginPath();
      ctx.moveTo(rx - d.x * 0.9 * S, ry - d.y * 0.9 * S);
      ctx.lineTo(rx + d.x * 0.9 * S, ry + d.y * 0.9 * S);
      ctx.stroke();
    }

    // Punta rúnica: un engarce dorado con una gema que late con el impulso
    const glow = 0.35 + b.thrustPower * 0.5 + (b.boostPower || 0) * 0.5;
    ctx.fillStyle = '#c9a04e';
    ctx.beginPath();
    ctx.arc(tip.x - d.x * 2 * S, tip.y - d.y * 2 * S, 4.2 * S, 0, 7);
    ctx.fill();
    ctx.fillStyle = `rgba(150,225,255,${Math.min(1, glow)})`;
    ctx.shadowColor = '#7ad4ff';
    ctx.shadowBlur = 10 * glow;
    ctx.beginPath();
    ctx.arc(tip.x - d.x * 2 * S, tip.y - d.y * 2 * S, 2.4 * S, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ── Ramas de la cola ──────────────────────────────────────────────────
    // Abanico en tres capas (oscura al fondo, clara adelante) con largos
    // irregulares: antes eran 7 líneas idénticas y se leía como un peine.
    const jitter = b.thrustPower * 2.5;
    const bxr = tail.x + d.x * 16 * S, byr = tail.y + d.y * 16 * S;
    // atadura de la escoba
    ctx.strokeStyle = '#5a3f22';
    ctx.lineWidth = 7 * S;
    ctx.beginPath();
    ctx.moveTo(bxr - d.x * 3 * S, byr - d.y * 3 * S);
    ctx.lineTo(bxr + d.x * 3 * S, byr + d.y * 3 * S);
    ctx.stroke();

    const capas = [
      { col: '#6d5324', w: 3.4, mul: 1.06, off: 0.06 },   // fondo, oscuro
      { col: CFG.colors.straw, w: 2.8, mul: 1.0, off: 0 },
      { col: '#e0c37a', w: 1.7, mul: 0.9, off: -0.05 },   // frente, claro
    ];
    for (const capa of capas) {
      ctx.strokeStyle = capa.col;
      ctx.lineWidth = capa.w * S;
      for (let i = -4; i <= 4; i++) {
        const a = b.angle + Math.PI + i * 0.115 + capa.off
                + Math.sin(this.t * 30 + i * 5) * 0.03 * jitter;
        // Largo irregular: un poco de variación fija por rama (no aleatoria
        // por frame, si no titilaría).
        const wob = 1 + Math.sin(i * 2.7) * 0.13;
        const len = (32 - Math.abs(i) * 2.4) * wob * capa.mul * S;
        ctx.beginPath();
        ctx.moveTo(bxr, byr);
        ctx.lineTo(bxr + Math.cos(a) * len, byr + Math.sin(a) * len);
        ctx.stroke();
      }
    }
    // atadura
    ctx.strokeStyle = '#7a4a20';
    ctx.lineWidth = 5 * S;
    ctx.beginPath();
    ctx.moveTo(tail.x + (d.x * 12 - d.y * 6) * S, tail.y + (d.y * 12 + d.x * 6) * S);
    ctx.lineTo(tail.x + (d.x * 12 + d.y * 6) * S, tail.y + (d.y * 12 - d.x * 6) * S);
    ctx.stroke();

    this._broomFX(ctx, b, tip, tail, d);
  }

  // Efectos de la escoba, comunes al dibujo geometrico y al skin de sprites.
  _broomFX(ctx, b, tip, tail, d) {
    // resplandor de propulsión
    if (b.thrustPower > 0.05) {
      const rad = (42 + b.boostPower * 40) * S;
      const g = ctx.createRadialGradient(tail.x, tail.y, 2, tail.x, tail.y, rad);
      const boost = b.boostPower;
      g.addColorStop(0, `rgba(${160 + boost * 95},${220 - boost * 60},${255 - boost * 160},${(0.5 + boost * 0.4) * b.thrustPower})`);
      g.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(tail.x, tail.y, rad, 0, 7); ctx.fill();
    }

    // A mucha velocidad el palo se ve cargado de magia: runas corriendo por
    // la madera y un halo a lo largo. Se reserva para velocidades altas.
    const speed = Math.hypot(b.vel.x, b.vel.y);
    const charge = clamp((speed - 620) / 700, 0, 1) * 0.55 + b.boostPower * 0.45;
    if (charge > 0.06) {
      ctx.save();
      ctx.globalAlpha = charge * 0.85;
      ctx.strokeStyle = b.boostPower > 0.3 ? '#ffd76a' : '#9fe6ff';
      ctx.lineWidth = (3 + charge * 3) * S;
      ctx.lineCap = 'round';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10 + charge * 14;
      ctx.beginPath();
      ctx.moveTo(tail.x + d.x * 16 * S, tail.y + d.y * 16 * S);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // runas corriendo hacia la punta
      for (let i = 0; i < 4; i++) {
        const ph = (this.t * (1.6 + charge * 2.6) + i * 0.25) % 1;
        const run = (16 + ph * 94) * S;
        const px = tail.x + d.x * run, py = tail.y + d.y * run;
        ctx.globalAlpha = charge * Math.sin(ph * Math.PI);
        ctx.fillStyle = '#fff6d8';
        ctx.fillRect(px - 1.5 * S, py - 1.5 * S, 3 * S, 3 * S);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Vibración del esfuerzo al estar clavada (se dibuja como temblor extra)
    if (b.strain > 0.15) {
      ctx.save();
      ctx.globalAlpha = b.strain * 0.5;
      ctx.strokeStyle = '#ffd08a';
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, (10 + Math.sin(this.t * 40) * 3 * b.strain) * S, 0, 7);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

  }

  // ---------- PELOTA ----------
  // Estela de la pelota, dibujada como CINTA continua.
  //
  // Antes era una fila de círculos superpuestos: a alta velocidad las muestras
  // quedan lejos entre sí y se veían como un collar de perlas separadas, no
  // como un rastro. Ahora se arma un polígono que recorre el camino por un
  // lado y vuelve por el otro, con ancho proporcional a la antigüedad — la
  // silueta clásica de cometa, que se lee continua a cualquier velocidad.
  _ballTrail(ctx, ball) {
    const tr = ball.trail;
    if (tr.length < 3) return;

    const speedF = Math.min((tr[tr.length - 1].sp || 0) / 900, 1);
    if (speedF < 0.05 && !(ball.fire > 0)) return;   // quieta: sin estela

    const fire = ball.fire || 0;
    const maxW = ball.r * (fire > 0 ? 1.15 + fire * 0.5 : 0.92);

    // Normal de cada punto, para poder darle grosor a la cinta
    const off = (p, k) => {
      const sp = Math.hypot(p.vx || 0, p.vy || 0) || 1;
      return { nx: -(p.vy || 0) / sp * k, ny: (p.vx || 0) / sp * k };
    };

    // Dos capas: una ancha y tenue (el halo del rastro) y una fina y brillante
    // (el núcleo). Juntas dan volumen sin necesidad de blur.
    for (const layer of [{ w: 1, a: fire > 0 ? 0.42 : 0.34 },
                         { w: 0.42, a: fire > 0 ? 0.75 : 0.70 }]) {
      ctx.beginPath();
      // Ida por un lado
      for (let i = 0; i < tr.length; i++) {
        const t = i / (tr.length - 1);            // 0 = más viejo, 1 = actual
        const p = tr[i];
        const w = maxW * layer.w * Math.pow(t, 1.35) * (0.45 + speedF * 0.55);
        const o = off(p, w);
        if (i === 0) ctx.moveTo(p.x + o.nx, p.y + o.ny);
        else ctx.lineTo(p.x + o.nx, p.y + o.ny);
      }
      // Vuelta por el otro
      for (let i = tr.length - 1; i >= 0; i--) {
        const t = i / (tr.length - 1);
        const p = tr[i];
        const w = maxW * layer.w * Math.pow(t, 1.35) * (0.45 + speedF * 0.55);
        const o = off(p, w);
        ctx.lineTo(p.x - o.nx, p.y - o.ny);
      }
      ctx.closePath();

      // Degradado a lo largo del vuelo: se apaga hacia la cola
      const a = tr[0], b = tr[tr.length - 1];
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      if (fire > 0) {
        g.addColorStop(0,    'rgba(180,30,0,0)');
        g.addColorStop(0.45, `rgba(224,58,18,${layer.a * 0.55 * fire})`);
        g.addColorStop(0.8,  `rgba(255,156,42,${layer.a * fire})`);
        g.addColorStop(1,    `rgba(255,243,176,${layer.a * fire})`);
      } else {
        g.addColorStop(0,    'rgba(255,240,190,0)');
        g.addColorStop(0.55, `rgba(255,236,170,${layer.a * 0.5 * speedF})`);
        g.addColorStop(1,    `rgba(255,250,222,${layer.a * speedF})`);
      }
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // El orbe. No es una pelota de cuero: es una esfera de energía encantada,
  // así que el dibujo apila capas de luz en vez de sombrear un volumen sólido.
  //
  // De afuera hacia adentro: halo lejano → halo cercano latiendo → cuerpo con
  // degradado → runas que giran → brillo especular → destello central. La
  // suma es lo que la hace verse encendida en vez de pintada.
  _ball(ctx, ball) {
    const r = ball.r * ball.scale;
    if (r < 1) return;

    const f = ball.fire || 0;
    const sp = Math.hypot(ball.vel?.x || 0, ball.vel?.y || 0);
    const speedF = Math.min(sp / 900, 1);

    ctx.save();
    ctx.translate(ball.pos.x, ball.pos.y);

    // ── Estiramiento por velocidad ──────────────────────────────────────
    // A gran velocidad el orbe se alarga en su dirección de vuelo y se
    // adelgaza de costado (volumen constante). Es el truco de animación que
    // hace que un objeto rápido se lea fluido en vez de saltar entre frames.
    // Moderado a propósito: pasado de 1.2 el orbe deja de leerse como esfera
    // y se ve como un óvalo aplastado.
    const stretch = 1 + speedF * 0.20;
    const squash  = 1 - speedF * 0.09;
    const flyAng  = sp > 1 ? Math.atan2(ball.vel.y, ball.vel.x) : 0;

    // ── Halos ───────────────────────────────────────────────────────────
    // Dos pulsos de distinta frecuencia: uno lento de fondo y uno rápido
    // encima. Al no ser múltiplos, la luz nunca repite el mismo patrón y se
    // percibe viva en vez de parpadeante.
    const pulseSlow = 1 + 0.06 * Math.sin(this.t * 2.1);
    const pulseFast = f > 0 ? 1 + 0.13 * Math.sin(this.t * 26)
                            : 1 + 0.05 * Math.sin(this.t * 7.3);
    const haloR = r * (2.5 + f * 1.5 + speedF * 0.6) * pulseSlow * pulseFast;

    ctx.save();
    ctx.rotate(flyAng);
    ctx.scale(stretch, squash);
    ctx.rotate(-flyAng);

    // Halo lejano: define cuánta luz derrama en la escena
    const gFar = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, haloR);
    if (f > 0) {
      gFar.addColorStop(0,    `rgba(255,214,120,${0.34 + f * 0.24})`);
      gFar.addColorStop(0.38, `rgba(255,120,26,${0.22 * f + 0.06})`);
      gFar.addColorStop(1,    'rgba(150,32,0,0)');
    } else {
      gFar.addColorStop(0,    `rgba(255,240,190,${0.30 + speedF * 0.16})`);
      gFar.addColorStop(0.42, `rgba(255,224,140,${0.14 + speedF * 0.10})`);
      gFar.addColorStop(1,    'rgba(255,210,110,0)');
    }
    ctx.fillStyle = gFar;
    ctx.beginPath(); ctx.arc(0, 0, haloR, 0, 7); ctx.fill();

    // Halo cercano: el borde luminoso pegado al cuerpo, más saturado
    const nearR = r * (1.5 + f * 0.4) * pulseFast;
    const gNear = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, nearR);
    if (f > 0) {
      gNear.addColorStop(0, `rgba(255,244,206,${0.5 + f * 0.3})`);
      gNear.addColorStop(1, 'rgba(255,140,30,0)');
    } else {
      gNear.addColorStop(0, `rgba(255,250,220,${0.42 + speedF * 0.2})`);
      gNear.addColorStop(1, 'rgba(255,228,150,0)');
    }
    ctx.fillStyle = gNear;
    ctx.beginPath(); ctx.arc(0, 0, nearR, 0, 7); ctx.fill();
    ctx.restore();

    // ── Cuerpo ──────────────────────────────────────────────────────────
    ctx.save();
    ctx.rotate(flyAng);
    ctx.scale(stretch, squash);
    ctx.rotate(-flyAng + ball.rot);

    const bg = ctx.createRadialGradient(-r * 0.34, -r * 0.38, r * 0.1, 0, 0, r);
    if (f > 0) {
      bg.addColorStop(0,    '#fffdf2');
      bg.addColorStop(0.42, '#ffe9a8');
      bg.addColorStop(0.72, f > 0.5 ? '#ffb43c' : '#f0c98a');
      bg.addColorStop(1,    f > 0.5 ? '#d8420f' : '#a8763c');
    } else {
      bg.addColorStop(0,    '#fffef7');
      bg.addColorStop(0.38, '#fdf3d4');
      bg.addColorStop(0.75, CFG.colors.ball);
      bg.addColorStop(1,    '#c2b48a');
    }
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();

    // Runas: dos anillos girando en sentidos opuestos. El contrarrotado es lo
    // que hace legible el giro sin necesidad de una textura.
    ctx.lineCap = 'round';
    ctx.strokeStyle = f > 0 ? 'rgba(122,36,8,0.85)' : 'rgba(138,116,64,0.7)';
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.58, 0, 7);
    ctx.stroke();

    // Arcos sueltos en el anillo exterior, contrarrotando
    ctx.save();
    ctx.rotate(-ball.rot * 1.7);
    ctx.strokeStyle = f > 0 ? 'rgba(255,236,180,0.75)' : 'rgba(255,248,220,0.6)';
    ctx.lineWidth = r * 0.085;
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, a0, a0 + 0.62);
      ctx.stroke();
    }
    ctx.restore();

    // Cruz interior (lo que ya marcaba la rotación), más sutil
    ctx.strokeStyle = f > 0 ? 'rgba(122,36,8,0.6)' : 'rgba(138,116,64,0.45)';
    ctx.lineWidth = r * 0.075;
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * 0.4, 0);
    ctx.moveTo(0, -r * 0.4); ctx.lineTo(0, r * 0.4);
    ctx.stroke();
    ctx.restore();

    // ── Brillo especular ────────────────────────────────────────────────
    // Va SIN rotar con el cuerpo: una luz reflejada no gira con el objeto, y
    // que se quede fija es justo lo que vende que la esfera es un volumen.
    const spec = ctx.createRadialGradient(
      -r * 0.36, -r * 0.4, 0, -r * 0.36, -r * 0.4, r * 0.55);
    spec.addColorStop(0, 'rgba(255,255,255,0.9)');
    spec.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.4, r * 0.55, 0, 7); ctx.fill();

    // Núcleo: un punto de luz que late fuerte. Es lo que hace que el orbe se
    // vea "encendido desde adentro" y no simplemente iluminado.
    const coreA = (f > 0 ? 0.55 : 0.32) + 0.12 * Math.sin(this.t * 4.7);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
    core.addColorStop(0, `rgba(255,255,255,${coreA})`);
    core.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, 7); ctx.fill();

    ctx.restore();
  }

  // ---------- INDICADOR DE APUNTADO ----------
  _aimIndicator(ctx, world) {
    if (world.botsMode || world.touch?.active) return;
    const cur = world.input.cursor;
    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 9, 0, 7);
    ctx.moveTo(cur.x - 14, cur.y); ctx.lineTo(cur.x - 5, cur.y);
    ctx.moveTo(cur.x + 5, cur.y); ctx.lineTo(cur.x + 14, cur.y);
    ctx.moveTo(cur.x, cur.y - 14); ctx.lineTo(cur.x, cur.y - 5);
    ctx.moveTo(cur.x, cur.y + 5); ctx.lineTo(cur.x, cur.y + 14);
    ctx.stroke();
    ctx.fillStyle = CFG.colors.p1;
    ctx.beginPath(); ctx.arc(cur.x, cur.y, 2.2, 0, 7); ctx.fill();
  }

  // ---------- HUD ----------
  // Lo que queda del HUD en canvas: los efectos que conviven con la escena
  // (fogonazo del gol, cartel del contragolpe, confetti, oscurecido del final,
  // números de práctica y hints de táctil). Las cajas, textos grandes y
  // botones son DOM ahora — hud.js los sincroniza y play.html los estila.
  _hud(ctx, world, W, H) {
    const m = world.match;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (world.practice) {
      this._practiceHud(ctx, world, W, H);
      return;
    }

    // Fogonazo de la explosión de gol: tapa la pantalla un instante y se va.
    if (m.flashT > 0) {
      ctx.fillStyle = `rgba(255,248,230,${clamp(m.flashT / CFG.goalBlast.flash, 0, 1) * 0.85})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Cartel del contragolpe encadenado (¡CRÍTICO! / ¡ZIGZAG!)
    this._chainToastDraw(ctx, W, H);

    // Final: el oscurecido y el confetti van en canvas (detrás del texto DOM)
    if (m.state === 'end') {
      ctx.fillStyle = 'rgba(5,4,15,0.55)';
      ctx.fillRect(0, 0, W, H);
      if (m.winner === 'p1' && !world.botsMode) this._confetti(ctx, world, W, H);
    }

    // Hints de táctil (los controles touch se dibujan en canvas)
    this._hints(ctx, world, W, H);
  }




  durationMinusYa(m) { return m.duration - 0.8; }

  // Práctica: la pastilla del título es DOM (hud.js); acá queda solo el
  // número flotante del último golpe, que convive con la escena.
  _practiceHud(ctx, world, W, H) {
    const cx = W / 2;
    const s = world.stats;
    if (s && s.lastHit > 0) {
      const age = (performance.now() - s.lastHitAt) / 1000;
      if (age < 3) {
        ctx.globalAlpha = Math.min(1, (3 - age) / 0.8);
        ctx.font = 'bold 44px Georgia, serif';
        ctx.fillStyle = s.lastAimed ? '#ffd76a' : 'rgba(255,255,255,0.85)';
        ctx.fillText(`${s.lastHit | 0}`, cx, H * 0.16);
        ctx.font = '17px Georgia, serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(s.lastAimed ? tr('practice.aimed') : tr('practice.free'), cx, H * 0.16 + 34);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Hints de TÁCTIL. En escritorio los reemplazó el coach (lecciones
  // contextuales ancladas, ver _coach); acá queda solo la rama touch, cuyos
  // controles son otros y sí siguen el esquema viejo de texto abajo.
  _hints(ctx, world, W, H) {
    if (world.botsMode) return;
    if (world.paused || world.match?.state !== 'play') return;

    let text = null;

    // ── Eventos del mundo (los enseña una sola vez, en cualquier control) ──
    // El coach cubre los CONTROLES; esto cubre lo que aparece en la cancha y
    // no se explica solo: el orbe fugitivo y el umbral del tiro de fuego.
    // Cada aviso se muestra ~5 s la primera vez que su evento ocurre.
    if (world.runner?.active && this._hintRunnerUntil === undefined) {
      this._hintRunnerUntil = this.t + 5.5;
    }
    if (this._hintRunnerUntil !== undefined && this.t < this._hintRunnerUntil
        && world.runner?.active) {
      text = tr('hint.runner');
    }
    const plA = world.playerA;
    if (!text && plA && plA.energy >= CFG.boost.max * CFG.whip.fireThreshold
        && this._hintFireUntil === undefined) {
      this._hintFireUntil = this.t + 5.5;
    }
    if (!text && this._hintFireUntil !== undefined && this.t < this._hintFireUntil) {
      text = tr('hint.fire');
    }

    // ── Controles táctiles (el teclado los enseña el coach) ────────────────
    if (!text && world.touch?.active) {
      const t = world.touch;
      if (!t.hasDir) text = tr('hint.touch.aim');
      else if (t.thrustTime < 1.4) text = tr('hint.touch.gas');
      else if (t.hitTime < 0.5) text = tr('hint.touch.hit');
    }
    if (!text) return;
    ctx.font = '20px Georgia, serif';
    ctx.textAlign = 'center';
    const pulse = 0.65 + 0.3 * Math.sin(this.t * 3);
    ctx.fillStyle = `rgba(255,240,200,${pulse})`;
    ctx.fillText(text, W / 2, H - 46);
  }






  // Anillo de carga del golpe (se dibuja en coordenadas de mundo sobre la escoba)
  _spinChargeRing(ctx, world) {
    if (!world.charge || !world.spin) return;
    const charge = world.charge;
    const spin   = world.spin;
    if (!charge.active) return;
    const b = world.playerA.broom;
    const cf = clamp(charge.t / 0.7, 0, 1);  // SPIN.chargeTime = 0.7
    const full = cf >= 0.999;
    const now  = performance.now();
    const R    = 46;
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = full ? '#fff0b0' : '#ffd76a';
    ctx.globalAlpha = full ? 0.7 + 0.3 * Math.sin(now / 45) : 0.9;
    ctx.lineWidth   = 4 + cf * 6;
    if (full) { ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 16; }
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, R, -Math.PI / 2, -Math.PI / 2 + cf * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- DEBUG ----------
  _debug(ctx, world) {
    // Límites físicos sobre la imagen: sirve para verificar que el campo
    // jugable coincide con el patio pintado.
    const { L, R, T, B, portalY, portalR } = CFG.arena;
    ctx.strokeStyle = 'rgba(0,255,200,0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(L, T, R - L, B - T);
    ctx.strokeStyle = 'rgba(255,80,140,0.9)';
    ctx.lineWidth = 5;
    for (const x of [L, R]) {
      ctx.beginPath();
      ctx.moveTo(x, portalY - portalR);
      ctx.lineTo(x, portalY + portalR);
      ctx.stroke();
    }

    for (const player of (world.players || [world.playerA, world.playerB].filter(Boolean))) {
      const r = player.rider;
      const b0 = player.broom;

      // Alcance real: círculo de la escoba vs círculo de los pies. El latigazo
      // funciona solo si el pie sale del círculo amarillo.
      ctx.strokeStyle = 'rgba(255,225,77,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b0.pos.x, b0.pos.y, CFG.broom.halfLen + CFG.ball.r + 7, 0, 7);
      ctx.stroke();
      const footR = Math.hypot(r.points.footF.x - b0.pos.x, r.points.footF.y - b0.pos.y) + CFG.ball.r + 7;
      ctx.strokeStyle = 'rgba(255,90,60,0.75)';
      ctx.beginPath();
      ctx.arc(b0.pos.x, b0.pos.y, footR, 0, 7);
      ctx.stroke();

      // Estado del latigazo
      ctx.fillStyle = '#fff';
      ctx.font = '15px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${r.phase}  swing ${r.swing.toFixed(2)}  pie ${footR.toFixed(0)}`,
        b0.pos.x + 90, b0.pos.y - 80);

      // constraints
      ctx.strokeStyle = 'rgba(0,255,140,0.7)';
      ctx.lineWidth = 1;
      for (const c of r.constraints) {
        ctx.beginPath();
        ctx.moveTo(r.points[c.a].x, r.points[c.a].y);
        ctx.lineTo(r.points[c.b].x, r.points[c.b].y);
        ctx.stroke();
      }
      // puntos
      for (const n of Object.keys(r.points)) {
        const p = r.points[n];
        ctx.fillStyle = n.startsWith('hand') ? '#ff4d6a' : '#00ff8c';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r || 4, 0, 7); ctx.fill();
      }
      // velocidad de la escoba
      const b = player.broom;
      ctx.strokeStyle = '#ffe14d';
      ctx.beginPath();
      ctx.moveTo(b.pos.x, b.pos.y);
      ctx.lineTo(b.pos.x + b.vel.x * 0.25, b.pos.y + b.vel.y * 0.25);
      ctx.stroke();
      // ángulo objetivo
      const ta = Math.atan2(player.control.aim.y - b.pos.y, player.control.aim.x - b.pos.x);
      ctx.strokeStyle = 'rgba(120,160,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(b.pos.x, b.pos.y);
      ctx.lineTo(b.pos.x + Math.cos(ta) * 90, b.pos.y + Math.sin(ta) * 90);
      ctx.stroke();
    }
    // velocidad de la pelota
    ctx.strokeStyle = '#ff9c4d';
    ctx.beginPath();
    ctx.moveTo(world.ball.pos.x, world.ball.pos.y);
    ctx.lineTo(world.ball.pos.x + world.ball.vel.x * 0.25, world.ball.pos.y + world.ball.vel.y * 0.25);
    ctx.stroke();
  }
}
