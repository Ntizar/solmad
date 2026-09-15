# Changelog

## 2026-09-15 — SolMAD instantáneo: matriz solar precalculada y edificios oficiales

El mapa ya no espera a nada para decirte dónde hay sol.

### Añadido
- **Matriz solar precalculada** (`public/solar-matrix.bin`, formato `SMSH v1`): estado sol/sombra/noche de las **6.202 terrazas** del censo en las **48 franjas de 30 min** del día, empaquetado a **2 bits por franja** → **97 KB** en total. El cliente lo lee y colorea el mapa con *lookup* O(1), sin raycasting y sin edificios.
- **Tileset de edificios estático** (`public/buildings/*.bin`, formato `SMBD v1`): **491.252 edificios** descargados de la cartografía del Ayto. (huella + **altura oficial**), **464.564 válidos** tras filtrar ruido, simplificados a ~7 puntos (tolerancia 1,2 m) en **341 tiles** de ~1,3 km → **13 MB**, 29 bytes por edificio.
- **Contador instantáneo** en el mapa: «X de 6.202 terrazas al sol · HH:MM», calculado desde la matriz.
- Scripts de pipeline: `npm run datos:edificios` (descarga + tiles) y `npm run precompute:matrix` (matriz del día, ~30 s con 6 hilos).
- GitHub Action `precompute-solar`: cada día a las 03:00 UTC regenera posición solar **y** matriz, y las commitea.
- Verificación headless por CDP (`scratch/verify-visual.py`): comprueba red real, colores pintados en el canvas, contador y errores JS.

### Cambiado
- El cliente **ya no llama a Overpass en vivo**: los edificios se sirven desde el tileset estático (manifest + tiles). Verificado: **0 peticiones a Overpass**, 9 tiles por vista.
- Las alturas ya son las oficiales del Ayto. en toda la ciudad, así que se elimina el enriquecido por red posterior.
- La matriz manda en el pintado; el motor en vivo (worker) solo refina el punto exacto (tu ubicación, bar seleccionado, puntos fuera del municipio).
- La matriz solo se aplica si su fecha (embebida en el binario, `AAAAMMDD`) coincide con el día en Madrid; si no, cae al motor en vivo.
- Atribución actualizada a los datos realmente usados: **Ayto. de Madrid (CC BY 4.0) + IGN (CC BY 4.0)**.

### Corregido
- **GitHub Pages estaba roto**: la app pedía los datos con rutas absolutas (`/terrazas.min.json`, `/solar-matrix.bin`, `/buildings/…`) y el sitio vive en `/solmad/` → todo 404 y el mapa vacío. Nuevo `src/lib/assets.ts` con `assetUrl()` basado en `import.meta.env.BASE_URL`, aplicado a terrazas, huellas, solar-day, matriz y tiles; iconos de `index.html` a rutas relativas. Verificado sirviendo `dist` bajo un subdirectorio y en la URL viva: **0 excepciones JS** (antes la app no arrancaba).
- **Huellas de terraza dentro de edificios**: el offset a la acera era fijo (5 m desde el eje de la vía) mientras el punto del censo ya está en la fachada, así que en calles estrechas la huella caía DENTRO del edificio y la terraza quedaba en sombra permanente. Medido: **350 de 6.154 terrazas (5,7%)** con sus 4 muestras dentro de un edificio. Ahora el offset se calcula desde la fachada real (retroceso 0,4 m) + una pasada de rescate que desplaza el mínimo necesario (16 direcciones, pasos de 0,5 m) las que siguen dentro → **bajan a 3**. Efecto medible en la matriz: sol diario 22,4% → **23,2%**, pico a las 14:00 68,9% → **71,1%**, plazas/peatonales al mediodía 48,6% → **56,5%**.
- Paginación del servicio de alturas del Ayto.: el WAF rechaza URLs largas (todo va por POST) y `DISTRITO` no es un campo válido (causaba 400 determinista). Descarga por `resultOffset` + control de huecos por `OBJECTID`: **491.252/491.252, cero huecos**.
- Douglas-Peucker colapsaba los anillos cerrados a 2 puntos (el segmento inicial medía 0). Ahora se simplifica el anillo abierto y se cierra después.
- El reset por cambio de hora ya no borra el pintado de la matriz.

### Medido
- Precompute completo: **~30 s** (176 zonas, 6 hilos).
- Matriz en cliente: **~2 ms** de descarga, pintado inmediato.
- Reparto del día (15/09/2026): sombra 29,7% · sol 22,4% · noche 47,9% · pendiente **0,0%**.
- Curva diaria verificada: noche hasta las 08:00, pico **68,9% de terrazas al sol a las 14:30**, apagado a las 21:00 (amanecer 07:55, ocaso 20:28).
- Paridad cliente↔precompute: badge «1093 de 6202 al sol» a las 19:36 = 17,6% calculado en Node para la franja 19:30.
- Producción (GitHub Pages y Vercel): matriz comprimida servida en **26 KB** (3 ms), 10 tiles de edificios (1,1 MB) por vista, **0 peticiones a Overpass** y **0 excepciones JS**.
