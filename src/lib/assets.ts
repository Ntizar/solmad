// URL de los ficheros de public/ respetando el `base` de Vite.
//
// La app se despliega en la raíz (Vercel) y en un subdirectorio (GitHub Pages,
// /solmad/). Con rutas absolutas ('/terrazas.min.json') el despliegue en
// subdirectorio devuelve 404 en todo; con esto funciona en los dos sitios.
const BASE = (import.meta.env.BASE_URL || './').replace(/\/+$/, '');

/** 'terrazas.min.json' -> './terrazas.min.json' (o '/solmad/terrazas.min.json') */
export function assetUrl(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}
