export function getPlatform() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const touchMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function locationHelpText() {
  const p = getPlatform();
  if (p === 'ios') return 'iPhone: Ajustes > Safari > Ubicacion > Permitir. Si usas Chrome: Ajustes > Chrome > Ubicacion.';
  if (p === 'android') return 'Android: toca el candado de la barra > Permisos > Ubicacion > Permitir.';
  return 'Navegador: candado junto a la URL > Permisos > Ubicacion > Permitir.';
}

export function locationSettingsUrl() {
  const p = getPlatform();
  if (p === 'android') return 'intent://settings/#Intent;scheme=android-app;end';
  return null;
}
