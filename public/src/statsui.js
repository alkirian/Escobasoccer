// Barras de stats para la UI. Vive aparte porque lo usan la galería y la
// pantalla de preparar partido, y duplicar el markup en dos lugares es la
// forma más segura de que se desincronicen.
import { STAT_IDS, STAT_INFO, statsOf } from './stats_chars.js';

// Devuelve el HTML de las 5 filas de pips (5 casilleros cada una).
// Se lee de un vistazo: sin números, solo cuánto está lleno.
export function statsHTML(charId) {
  const s = statsOf(charId);
  return `<div class="stats">${STAT_IDS.map((k) => {
    const info = STAT_INFO[k];
    const pips = Array.from({ length: 5 }, (_, i) =>
      `<span class="pip${i < s[k] ? ' on' : ''}"></span>`).join('');
    return `<div class="strow" style="--c:${info.color}">
      <span class="sn">${info.icono} ${info.label}</span>
      <span class="pips">${pips}</span>
    </div>`;
  }).join('')}</div>`;
}
