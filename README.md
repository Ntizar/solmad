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
- Enseña al instante cuántas terrazas tienen sol en la franja elegida (**«X de 6.202 terrazas al sol»**), calculado de antemano: sin esperas y sin llamadas a APIs externas al abrir la web.
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

Requisitos: **Node 20+** y, solo para `npm run verificar:web`, **Python 3** (sin dependencias: el cliente WebSocket va implementado sobre la librería estándar) y Chrome o Edge instalado.

### 1. Dependencias

```bash
npm ci
```

### 2. Datos que NO están en el repo

Dos ficheros grandes se generan en local y están ignorados por Git:

| Fichero | Para qué | Cómo se obtiene |
|---|---|---|
| `data/vias-madrid.json` (~41 MB) | orientar las huellas de terraza al eje de la vía | `npm run fetch:vias` |
| `public/terrazas.min.json` (~2 MB) | censo de terrazas limpio para el cliente | `npm run prepare:data` |

`data/terrazas.json` (censo crudo del Ayto.) sí está versionado, así que `prepare:data` funciona desde un clon limpio.

### 3. Pipeline completo (una vez, o cuando cambien los datos)

```bash
npm run datos:edificios   # 491.252 edificios del Ayto. -> public/buildings/*.bin (~10-15 min, reanudable)
npm run prepare:data      # censo -> public/terrazas.min.json
npm run fetch:vias        # viario OSM -> data/vias-madrid.json (si falta)
npm run prepare:huellas   # huellas de terraza -> public/terrazas-huellas.json (~2,5 min)
npm run precompute:sun    # posición solar del día -> public/solar-day.json
npm run precompute:matrix # matriz solar -> public/solar-matrix.bin (~30 s)
```

O todo de una tacada: `npm run datos:todo`.

**Importante:** `public/buildings/*.bin` y `public/solar-matrix.bin` **sí** se versionan (los necesita el cliente y el cron diario). Si cambias las huellas, vuelve a lanzar `precompute:matrix --force` para recalcular los estados.

### 4. Desarrollo y build

```bash
npm run dev      # servidor de desarrollo
npm run build    # prepare:data + precompute:sun + precompute:matrix + tsc + vite -> dist/
```

`npm run build` regenera la matriz del día automáticamente (si falla, avisa y sigue con la versionada), así que un build normal ya deja la web fresca.

---

## Verificación

Antes de dar algo por bueno (o antes de tocar geometría de terrazas/sombras):

```bash
npm run verify:matrix          # sanea public/solar-matrix.bin: formato, curva diaria, plazas vs calles
npm run qa:huellas             # ¿cuántas huellas caen dentro de un edificio? (debe ser ~0)
npm run qa:huellas-geometria   # distancia firmada de cada huella a la fachada más cercana
npm run verificar:web -- https://ntizar.github.io/solmad/ captura.png --zoom 6
```

`verificar:web` abre un Chrome headless propio por DevTools Protocol y comprueba lo que no ve un test unitario: recursos realmente descargados (tiles de edificios, matriz, nada de Overpass), el contador, **los píxeles pintados en el canvas** (las huellas van en canvas por `preferCanvas`, no en SVG) y las **excepciones de JavaScript**.

- Devuelve **0** si todo va bien, **2** si hay errores JS y **1** si no pudo arrancar. Sirve tal cual en CI.
- `--zoom N` hace N clics de zoom antes de medir (las huellas solo se pintan a partir de zoom 15).
- Puerto y perfil de Chrome se generan por proceso: no se engancha a un navegador zombi de una ejecución anterior.

---

## Despliegue

El proyecto se publica en **dos destinos** desde la misma rama `main`:

| Destino | URL | Cómo |
|---|---|---|
| GitHub Pages | `https://ntizar.github.io/solmad/` | automático al hacer push (`deploy-pages.yml`) |
| Vercel | `https://solmad.vercel.app` | proyecto conectado al repo |

Ojo con las rutas: Pages sirve la app en un **subdirectorio** (`/solmad/`) y Vercel en la **raíz**. Por eso todos los datos se piden con `assetUrl()` (`src/lib/assets.ts`), que respeta `import.meta.env.BASE_URL`. Nunca uses rutas absolutas tipo `/terrazas.min.json`: rompen Pages.

### Antes de desplegar

```bash
npm run build
npm run verificar:web -- http://127.0.0.1:4188/ captura.png --zoom 6   # sirviendo dist/ en local
```

### Automatización diaria

El workflow `precompute-solar` (`.github/workflows/precompute-sun.yml`) se ejecuta a las **03:00 UTC** y:

1. `npm run prepare:data` (terrazas.min.json no está versionado),
2. `npm run precompute:sun` → `public/solar-day.json`,
3. `npm run precompute:matrix` → `public/solar-matrix.bin` + `meta.json`,
4. commitea los cambios, lo que dispara el despliegue.

Si un día no corre, la app sigue funcionando con la matriz del último día (el sol se mueve ~1°/día y el contador avisa con un `precalc AAAA-MM-DD` si la matriz no es de hoy).

### Variables de entorno (solo Vercel)

Para que el formulario de aportes y la caché solar funcionen, define en el proyecto de Vercel:

```text
SOLMAD_GITHUB_TOKEN=token_con_permiso_contents_write
GITHUB_OWNER=Ntizar
GITHUB_REPO=solmad
GITHUB_BRANCH=main
CONTRIBUTIONS_PATH=data/contributions.json
SUN_CACHE_PATH=data/sun-cache.json
```

`SOLMAD_GITHUB_TOKEN` debe ser un secreto de Vercel, nunca código cliente. Los endpoints `/api/contribute` y `/api/sun-cache` lo usan para escribir en GitHub mediante la API oficial. En Pages esos endpoints no existen (dan 404), pero la app funciona igual: son opcionales.

### Aportes de usuarios

Los aportes no entran directos en `main`: se guardan en la rama `solmad/review-contributions` y abren una Pull Request para revisarlos antes de mezclarlos. GitHub avisa al propietario/revisores del repo.

Para sacar el token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained token. Dale acceso solo al repo `Ntizar/solmad` y permiso **Contents: Read and write**. Después pégalo en Vercel como `SOLMAD_GITHUB_TOKEN` en Production, Preview y Development.

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

Censo de terrazas (data/terrazas.json) + viario OSM (data/vias-madrid.json)
        │  npm run prepare:data + prepare:huellas
        ▼
public/terrazas.min.json + public/terrazas-huellas.json
```

- `npm run datos:edificios` — descarga el municipio completo y construye el tileset (reanudable; hay que relanzarlo si se corta).
- `npm run precompute:matrix` — recalcula la matriz del día. Formato `SMSH v1`: cabecera, ids y estados empaquetados a 2 bits.
- `npm run datos:todo` — encadena el pipeline completo (edificios → censo → viario → huellas → sol → matriz).
- Formatos binarios documentados en la cabecera de `scripts/build-buildings-tiles.mjs` (`SMBD v1`) y `src/lib/solarMatrix.ts` (`SMSH v1`).
- Todo está versionado en el repo, así que un `npm run build` normal ya deja la web fresca.
- Tras tocar las huellas hay que recalcular la matriz con `npm run precompute:matrix -- --force`.

---

## Estado actual

- Listo para iteracion publica controlada.
- Mapa estable con Leaflet y tiles sin autenticacion.
- Hora visible sobre el mapa con cambios rapidos de `-15` y `+15` minutos.
- Calculo de sombras sobre **huellas y alturas oficiales del Ayto. de Madrid**, con precalculo diario (matriz) y motor en vivo para puntos exactos.
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
