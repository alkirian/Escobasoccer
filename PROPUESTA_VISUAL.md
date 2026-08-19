# ¿Hasta dónde se pueden llevar los gráficos?

Medí antes de proponer. Los números cambian bastante lo que hay que hacer.

---

## Cuánto presupuesto tenés (medido en 2v2, 4 magos)

| Escenario | Costo por frame |
|---|---|
| Cancha vacía | **0.45 ms** |
| Con 300 partículas | **0.52 ms** |
| Explosión completa (600 partículas, tope) | **0.48 ms** |
| **Presupuesto a 60 FPS** | **16.67 ms** |
| **Presupuesto a 120 FPS** | **8.33 ms** |

**Estás usando el 3% del presupuesto.** Tenés margen para gastar **30 veces
más** y seguir a 60 FPS clavados. Incluso apuntando a 120 FPS te sobra 16×.

Costo por personaje: entre **0.13 ms** (Mordrak) y **0.23 ms** (el mago
clásico, que resultó el más caro de todos).

### El hallazgo que me sorprendió

Medí Ízar con y sin `shadowBlur`: **0.227 ms vs 0.236 ms**. O sea, **el
brillo no cuesta nada** — la diferencia está dentro del ruido de medición.

Esto **invalida la sospecha que yo mismo tenía** en el análisis anterior,
donde señalé el `shadowBlur` como el culpable número uno de la sensación de
lentitud en 2v2. Estaba equivocado: Chrome lo resuelve por GPU y a esta
escala es gratis.

**Conclusión importante**: si sentiste lentitud en 2v2, **no era el dibujo**.
Los candidatos reales son el `devicePixelRatio` en pantallas grandes (el
canvas puede estar pintando 8 millones de píxeles) o algo del navegador,
no tu código.

---

## Lo que se puede agregar (ordenado por impacto/costo)

### 🥇 Nivel 1 — Alto impacto, costo casi nulo

**1. Iluminación del mapa sobre los personajes**
Las antorchas del castillo están pintadas en el fondo pero no iluminan a
nadie. Un degradado radial cálido y sutil sobre los magos cuando pasan cerca
los integraría al escenario. Es 1-2 `createRadialGradient` por frame.
*El cambio que más "juego caro" haría parecer al tuyo.*

**2. Sombra de contacto dinámica**
Ya tenés sombra en el piso. Falta que se deforme: más chica y oscura cuando
el mago está bajo, más grande y difusa cuando vuela alto. Cero costo extra
(mismo `ellipse`, distinto radio y alpha).

**3. Profundidad de campo falsa en el fondo**
Dibujar el mapa con un leve desenfoque o una capa oscura semitransparente
haría que los personajes "salten" hacia adelante. Un `fillRect` con alpha.

**4. Vignette + corrección de color**
Un degradado radial oscuro en los bordes de la pantalla. Es EL truco más
barato para que algo se vea profesional. Un `fillRect` por frame.

**5. Motion blur direccional en la pelota rápida**
Ya tenés estela; falta que la pelota misma se estire en su dirección de
vuelo cuando va a máxima velocidad. Es un `scale` no uniforme.

### 🥈 Nivel 2 — Alto impacto, costo moderado (y te sobra)

**6. Sistema de luces dinámicas real**
Un canvas offscreen del tamaño de la pantalla donde se pintan los focos
(gemas de escobas, orbes, explosiones, tiro de fuego) y se compone con
`globalCompositeOperation = 'screen'`. **Este es el salto grande**: el juego
pasaría de "vectores lindos" a "escena iluminada". Costo estimado: 1-2 ms.
Con tu margen, entra sobrado.

**7. Deformación por velocidad (squash & stretch)**
Estirar levemente al mago en su dirección de vuelo a alta velocidad. Es la
técnica clásica de animación que hace que todo se sienta más vivo. Un
`ctx.scale` no uniforme antes de dibujar el cuerpo.

**8. Partículas con física de verdad**
Hoy son cuadraditos. Con rotación, escala variable y algunas con rebote
contra el piso, la explosión del gol se sentiría el doble de rica. El
sistema ya está agrupado por color — agregar rotación es barato.

**9. Estela del mago (no solo de la escoba)**
A alta velocidad, dejar una silueta fantasma del cuerpo (ya tenés el código
del dash). Ampliarlo a "siempre que vueles rápido".

**10. Impactos con anillo de choque**
Cuando la pelota rebota fuerte: un anillo blanco que se expande y desvanece
en el punto exacto. Dos `arc()`. Vende muchísimo el impacto.

### 🥉 Nivel 3 — Efectistas, con cuidado

**11. Aberración cromática en momentos grandes**
Dibujar el frame tres veces con offsets mínimos en rojo/azul durante la
explosión del gol. **Cuesta 3× el frame**, pero solo dura 0.3 s. Con tu
margen se banca — pero es fácil pasarse de rosca.

**12. Trails con `globalCompositeOperation = 'lighter'`**
Que las estelas se sumen entre sí en vez de taparse. Cambio de una línea,
efecto notable, pero puede quemar la imagen si hay muchas juntas.

---

## Lo que NO haría

- **Cambiar a WebGL.** Ganarías rendimiento que no necesitás, y perderías la
  simplicidad de Canvas 2D que hace que todo el proyecto sea legible.
- **Sombras proyectadas reales** (raycasting). Costo alto, y en una vista
  lateral con fondo pintado casi no se notaría.
- **Iluminación por píxel.** Fuera de escala para el retorno.
- **Texturas.** Romperían el estilo vectorial limpio que ya tenés.

---

## Mi recomendación

**Hacé el Nivel 1 completo.** Son cinco efectos, todos de costo casi nulo, y
en conjunto cambian bastante la percepción de calidad. Estimo medio día.

**Después, el punto 6 (luces dinámicas) solo.** Es el único que por sí solo
transforma el look, y tenés margen de sobra. Ahí sí mediría FPS reales en tu
máquina antes y después — no por el costo del dibujo, sino porque el
offscreen del tamaño de pantalla es la única cosa de esta lista que escala
con la resolución del monitor.

**Antes de todo eso**, resolvería el misterio de la lentitud que sentiste en
2v2, porque no era el dibujo. Un overlay `?perf` que muestre ms de
simulación vs ms de dibujo vs FPS reales te lo diría en un minuto. **No
tiene sentido agregar efectos sobre un problema que todavía no entendemos.**

---

## En una frase

Tenés 30× de margen: los gráficos no son tu límite. El Nivel 1 es medio día
de trabajo y sube mucho la percepción de calidad; las luces dinámicas son el
salto grande y también entran. Pero primero averiguá por qué se sintió lento
el 2v2, porque el dibujo está inocente.
