# SolMAD

> La pregunta mas importante de Madrid, despues de "quien ha dejado esto en doble fila":
>
> **En que terraza me puedo tomar una caña ahora mismo y que me de el sol?**

SolMAD cruza el censo oficial de terrazas de Madrid con la posicion del sol y las sombras aproximadas de edificios de OpenStreetMap. El resultado es un mapa para encontrar ese sitio exacto donde pedir una caña, ponerse dramaticamente de cara al astro rey y fingir que la vida esta bajo control.

https://solmad.vercel.app

---

## Que hace

- Muestra mas de **6.200 terrazas abiertas** del Ayuntamiento de Madrid.
- Calcula si una terraza tiene **sol directo ahora mismo**.
- Estima cuanto sol le queda durante el dia, empezando por el bar abierto, las terrazas visibles y las cercanas.
- Permite cambiar la hora con slider, presets y botones rapidos de `-15` / `+15`.
- Distingue terrazas con sol, sombra y noche.
- Abre una ficha con horario, mesas, sillas, superficie y ruta en Google Maps.
- Tiene boton **Sorpresa** para dejar que el destino hostelero decida.
- Pide ubicacion solo con gesto explicito del usuario para funcionar mejor en iPhone y Android.
- Usa mapas libres sin tokens ni autenticacion.

Si alguna sombra se equivoca por un toldo, un arbol o una fachada con ganas de protagonismo: calma. Es una primera version presentable, no una tesis doctoral con sombrilla homologada.

---

## Stack

- **Vite + React + TypeScript**
- **Leaflet** para el mapa
- **Leaflet.markercluster** para que 6.200 terrazas no conviertan Madrid en una sopa de puntitos
- **IGN WMTS** como mapa base libre sin login ni token (CC BY 4.0)
- **Web Workers + Comlink** para el motor de sombras (raycast 2D sobre fachadas)
- **Matriz solar precalculada** en binario (`public/solar-matrix.bin`) para pintar las 6.200 terrazas al instante
- **Tileset de edificios** propio (`public/buildings/*.bin`) con huellas y alturas oficiales del Ayto.
- **SunCalc** para la posicion solar
- **Three.js** para la intro cinematografica
- **Zustand** para estado global
- **Tailwind** para la interfaz

---

## Como correrlo

Requisitos: Node 18+.

```bash
npm install
npm run dev
```

Build de produccion:

```bash
npm run build
```

Para que el formulario de aportes y la cache solar funcionen desde Vercel, define estas variables de entorno en el proyecto:

```text
SOLMAD_GITHUB_TOKEN=token_con_permiso_contents_write
GITHUB_OWNER=Ntizar
GITHUB_REPO=solmad
GITHUB_BRANCH=main
CONTRIBUTIONS_PATH=data/contributions.json
SUN_CACHE_PATH=data/sun-cache.json
```

`SOLMAD_GITHUB_TOKEN` debe ser un secreto de Vercel, nunca codigo cliente. Los endpoints `/api/contribute` y `/api/sun-cache` lo usan para escribir en GitHub mediante la API oficial.

Los aportes de usuarios no entran directos en `main`: se guardan en la rama `solmad/review-contributions` y abren una Pull Request para revisarlos antes de mezclarlos. GitHub envia el aviso al propietario/revisores del repo.

Para sacarlo: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained token. Dale acceso solo al repo `Ntizar/solmad` y permiso **Contents: Read and write**. Despues pegalo en Vercel como `SOLMAD_GITHUB_TOKEN` en Production, Preview y Development si quieres probarlo todo.

El script `prepare:data` se ejecuta antes de `dev` y `build`. Lee el JSON bruto del Ayuntamiento, limpia strings, filtra locales abiertos, reproyecta coordenadas `EPSG:25830 -> WGS84` y genera:

```text
public/terrazas.min.json
```

---

## Como calcula el sol

Hay dos caminos, y el primero es el que ve casi todo el mundo:

**1. Matriz solar precalculada (instantáneo).** Cada noche, un script (y la GitHub Action `precompute-solar`) calcula el estado **sol / sombra / noche** de **las 6.202 terrazas** en las **48 franjas de 30 minutos** del día, cruzando la posición del sol (SunCalc) con los **464.500 edificios oficiales** del Ayto. El resultado se empaqueta en **2 bits por franja** → un fichero de **97 KB** (`public/solar-matrix.bin`). El navegador lo descarga en **~2 ms** y colorea el mapa entero con un *lookup* O(1): sin raycasting, sin edificios, sin esperas y sin depender de ninguna API externa.

**2. Motor en vivo (punto exacto).** Cuando hace falta precisión al minuto o un punto arbitrario (tu ubicación, un bar en concreto), el Web Worker indexa las fachadas de los edificios oficiales de la zona en un grid y traza rayos hacia el sol. Estados: `0=sombra · 1=sol · 2=noche · 3=pendiente`.

Los datos de edificios **ya no se piden a Overpass en vivo**: se sirven desde un tileset estático propio, lo que elimina rate limits, timeouts y cuelgues de Safari, y da alturas oficiales en toda la ciudad.

Traduccion humana: intenta responder si vas a estar al solecito o en modo bufanda interior.

---

## Pipeline de datos

```
Ayto. de Madrid (sigma.madrid.es, CC BY 4.0)
        │  npm run datos:edificios      ← 491.252 edificios, paginado por POST
        ▼
public/buildings/*.bin                  ← 341 tiles, 464.564 edificios, 13 MB (29 B/edificio)
        │  npm run precompute:matrix    ← 176 zonas en paralelo, ~30 s
        ▼
public/solar-matrix.bin                 ← 6.202 terrazas x 48 franjas, 97 KB
        │
        ▼
Cliente: color instantáneo + contador "X de 6.202 terrazas al sol"
```

- `npm run datos:edificios` — descarga el municipio completo y construye el tileset (reanudable; hay que relanzarlo si se corta).
- `npm run precompute:matrix` — recalcula la matriz del día. Formato `SMSH v1`: cabecera, ids y estados empaquetados a 2 bits.
- Todo está versionado en el repo, así que un `npm run build` normal ya deja la web fresca.

---

## Estado actual

- Listo para iteracion publica controlada.
- Mapa estable con Leaflet y tiles sin autenticacion.
- Hora visible sobre el mapa con cambios rapidos de `-15` y `+15` minutos.
- Calculo de sombras aproximado por edificios OSM, con cache y progreso visible.
- **Precalculo offline diario hecho**: matriz solar automática (cron 03:00 UTC) + posición solar. El mapa se pinta al instante y el contador de terrazas al sol sale del fichero, no de cálculos en vivo.
- **Edificios oficiales del Ayto.** con altura real (antes alturas estimadas de OSM).
- Limitaciones: no considera arbolado real, toldos, sombrillas, soportales ni sombras interiores. La matriz es del día de generación (el sol se mueve ~1°/día, así que aguanta varios días con error mínimo; el badge avisa si es de otro día).
- Pendiente para futuras versiones: arbolado, toldos, favoritas, modo "necesito vitamina D ya" y ranking de mejores terrazas por minutos de sol.

---

## Datos y creditos

- Terrazas: [Portal de datos abiertos del Ayuntamiento de Madrid](https://datos.madrid.es/) (CC BY 4.0).
- Edificios y alturas: Cartografía del Ayuntamiento de Madrid (`sigma.madrid.es`, CC BY 4.0).
- Mapa base: IGN — Instituto Geográfico Nacional (CC BY 4.0).
- Datos auxiliares: OpenStreetMap contributors (ODbL).
- Calculo solar: [SunCalc](https://github.com/mourner/suncalc).

Hecho con sol, ganas y algo de cafe por **David Antizar** para los disfrutones de Madrid.
