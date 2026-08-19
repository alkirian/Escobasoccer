# ¿Agrandar el mapa? — medición y recomendación

Medí la cancha antes de opinar. El resultado cambió lo que iba a
recomendarte, así que empiezo por ahí.

---

## Lo que mide la cancha hoy

| | Valor |
|---|---|
| Ancho jugable (arco a arco) | **3169 unidades** = ~17 magos de largo |
| Alto jugable | 1453 unidades = ~8 magos |
| Cruzar de arco a arco (sin boost) | **4.4 segundos** |
| Cruzar con boost | **2.4 segundos** |
| Velocidad tope normal / con boost | 838 / 1676 u/s |

---

## El hallazgo: el problema NO es el tamaño del mapa

**La cámara ya muestra el 110% del ancho jugable en cualquier pantalla.**

Eso significa que el mapa entero entra en la pantalla, siempre. Y que
`MAP` (el multiplicador de escala) **no cambia nada de lo que te importa**:
si agrando el mapa 1.6×, la cámara se aleja 1.6× para seguir mostrándolo
entero, y todo se ve exactamente igual — solo que los magos quedan más
chiquitos. Lo verifiqué: con MAP 1×, 1.35× y 1.6× el porcentaje visible es
idéntico (110%). Lo único que cambia es que pasás de ver 19 magos de ancho
a ver 30 magos de ancho: **el mismo espacio, con muñecos más chicos.**

O sea: subir `MAP` no da "más recorrido". Da **peor visibilidad**.

Lo que sí te falta —y en eso tenés toda la razón— es **tiempo de vuelo
entre acciones**. 4.4 segundos de punta a punta es poco: por eso las
habilidades de Zefir (estela), Vendaval (viento a favor en línea recta) y
Silvano (control de zonas) se sienten apretadas. No hay pista.

---

## Las tres formas reales de dar más recorrido

### Opción A — Cancha más ancha, cámara que sigue la acción ⭐
Estirar SOLO el ancho jugable (`arena.L/R`) a ~1.5×, sin tocar el alto ni
el tamaño de los magos, y **desacoplar la cámara**: que siga al promedio
jugador-pelota con zoom dinámico, en vez de mostrar el mapa entero.

- Cruce arco a arco pasaría de 4.4s a **~6.5s**: hay viaje real.
- Los magos siguen del mismo tamaño en pantalla (lectura intacta).
- Las habilidades de recorrido cobran sentido.
- **La cámara dinámica ya existe en el código** (`camera.js` tiene
  `closeDist`, `farDist`, `zoomClose`, `zoomFar` y comentarios que dicen
  que seguía al promedio) — solo está desactivada. Es reactivar y ajustar.
- **El costo real**: hay que estirar la imagen del mapa. Como el arte es
  un castillo simétrico, se puede duplicar el tramo central sin que se
  note, o directamente pintar los laterales.

### Opción B — Cancha más ancha SIN tocar la cámara
Mismo estiramiento, pero la cámara sigue mostrando todo → los magos se ven
más chicos (de 19 a ~28 por pantalla). Es la opción barata: cero trabajo de
cámara, pero paga en legibilidad. **En móvil sería un problema serio.**

### Opción C — Bajar la velocidad en vez de agrandar
Reducir `thrust` y el techo de velocidad ~25% hace que la misma cancha se
sienta el doble de grande. Costo cero en arte y cámara.
**Pero mata la sensación de velocidad**, que hoy es de lo mejor que tiene el
juego. No la recomiendo salvo como ajuste fino combinado con A.

---

## Mi recomendación

**Opción A, en dos pasos y midiendo entre uno y otro:**

1. **Primero la cámara** (sin tocar el mapa). Reactivar el seguimiento
   dinámico que ya está escrito en `camera.js`. Solo con eso el mapa actual
   ya se siente más grande, porque dejás de ver todo el tiempo los dos arcos.
   Es reversible en un minuto si no te gusta.
2. **Después el ancho**, a 1.4-1.5× (no más). Con la cámara siguiendo, el
   cruce llega a ~6.5s y aparece el "medio campo" que hoy no existe.

Sobre el **3v3 a futuro**: con la cancha 1.5× más ancha y la cámara
dinámica, entran 6 magos sin amontonarse. Sin agrandar, un 3v3 sería un
tumulto — ahí tu instinto es correcto.

---

## Lo que NO recomiendo

- **Subir `MAP`** (el multiplicador global). Es lo que parece la solución
  obvia y es justo lo que no funciona: agranda el arte y la cámara compensa,
  dejándote en el mismo lugar con magos más chicos.
- **Agrandar el alto.** El juego es lateral y el alto actual (8 magos) está
  bien: más alto haría que la pelota se pierda arriba y que defender sea
  imposible.
- **Hacerlo antes que los stats.** Los stats son un sistema cerrado y
  medible; el mapa toca arte, cámara, IA y balance a la vez. Si hacemos las
  dos cosas juntas y algo se siente raro, no vamos a saber cuál fue.

---

## Orden sugerido

1. Stats + habilidades (tanda ya propuesta) — sistema cerrado.
2. Cámara dinámica — un cambio, gran efecto, reversible.
3. Ancho de cancha 1.4× + arte del mapa.
4. Recién ahí, 3v3.
