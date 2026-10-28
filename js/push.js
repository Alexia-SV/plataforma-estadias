/* ==========================================================================
   push.js — Notificaciones push (Push API)
   --------------------------------------------------------------------------
   El usuario las activa en «Mi perfil». El navegador crea una suscripción
   con el servicio de push de su fabricante (Google, Mozilla, Microsoft o
   Apple) y se guarda en la tabla suscripciones_push. Después, la función
   enviar-push del servidor manda el aviso, y sw.js lo muestra aunque la app
   esté cerrada:
     · al alumno, cuando su asesor deja una observación;
     · al asesor, cuando su alumno sube una versión nueva.

   Expone App.push con:
     disponible                 ¿el navegador tiene Push API y service worker?
     estado()                   'activas' | 'inactivas' | 'bloqueadas' | 'no-disponible'
     activar() · desactivar()   pide permiso y suscribe / cancela la suscripción
     avisar(versionId)          pide al servidor que avise a la otra persona
   Depende de auth.js.
   ========================================================================== */
window.App = window.App || {};

App.push = (() => {
  'use strict';

  const { auth } = App;
  const FUNCION = 'enviar-push';
  const disponible = Boolean('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext);

  // La clave pública VAPID llega en base64url; el navegador la pide en bytes
  const bytes = (b64) => {
    const base = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base), (c) => c.charCodeAt(0));
  };

  async function registro() {
    const r = await navigator.serviceWorker.getRegistration();
    if (!r) throw new Error('La app todavía no termina de instalarse. Recarga la página e inténtalo de nuevo.');
    return r;
  }

  async function estado() {
    if (!disponible) return 'no-disponible';
    if (Notification.permission === 'denied') return 'bloqueadas';
    const r = await navigator.serviceWorker.getRegistration();
    const suscripcion = await r?.pushManager.getSubscription();
    return suscripcion && Notification.permission === 'granted' ? 'activas' : 'inactivas';
  }

  async function activar() {
    if (!disponible) throw new Error('Este navegador no admite notificaciones push. En iPhone, primero agrega la app a la pantalla de inicio.');
    if (!navigator.onLine) throw new Error('Necesitas conexión a internet para activar las notificaciones.');
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('No diste permiso para mostrar notificaciones. Puedes cambiarlo en la configuración del sitio.');

    const { data, error } = await auth.cliente.functions.invoke(FUNCION, { body: { accion: 'clave' } });
    if (error || !data?.clave) throw new Error('El servidor de notificaciones no está configurado todavía.');

    const r = await registro();
    let suscripcion = await r.pushManager.getSubscription();
    if (!suscripcion) suscripcion = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(data.clave) });
    const { endpoint, keys } = suscripcion.toJSON();
    const { error: e } = await auth.cliente.rpc('registrar_push', { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
    if (e) throw auth.error(e);
  }

  async function desactivar() {
    const r = await navigator.serviceWorker.getRegistration();
    const suscripcion = await r?.pushManager.getSubscription();
    if (!suscripcion) return;
    await auth.cliente.rpc('quitar_push', { p_endpoint: suscripcion.endpoint }).catch(() => {});
    await suscripcion.unsubscribe().catch(() => {});
  }

  // No interrumpe nada si falla: el aviso es un extra
  async function avisar(versionId) {
    if (!navigator.onLine || !auth.cliente) return null;
    try {
      const { data } = await auth.cliente.functions.invoke(FUNCION, { body: { accion: 'avisar', version: versionId } });
      return data;
    } catch {
      return null;
    }
  }

  return { disponible, estado, activar, desactivar, avisar };
})();
