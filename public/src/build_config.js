// Configuración de BUILD — un solo lugar que dice para qué plataforma se
// compiló este paquete. El script de build (scripts/build-crazygames.mjs)
// REEMPLAZA este archivo en dist/ por la variante del portal; el repo
// siempre queda en standalone.
//
// Regla: nadie pregunta "¿estamos en CrazyGames?" por su cuenta (ni mirando
// la URL, ni el referrer). Se lee de acá, y el core del juego ni siquiera
// hace eso: habla con Platform (src/platform/platform.js), que es quien
// consulta esta config. Así, integrar el SDK más adelante toca UN archivo.
export const BUILD_CONFIG = {
  platform: 'standalone',   // 'standalone' | 'crazygames'
  portalMode: false,        // true = entrada rápida a gameplay, sin extras
  pwa: true,                // registrar service worker / manifest
  externalLinks: true,      // mostrar enlaces fuera del juego (GitHub, etc.)
  // Cargar el SDK de CrazyGames. Basic Launch va SIN SDK (false): no se pide
  // ningún script externo. Se pone en true recién para Full Launch, y sólo
  // junto con platform: 'crazygames' — la implementación ya está escrita en
  // src/platform/crazygames.js.
  sdk: false,
  debug: false,
};
