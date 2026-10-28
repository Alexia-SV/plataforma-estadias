// ==========================================================================
// enviar-push — Notificaciones push de la tesina (Supabase Edge Function)
// --------------------------------------------------------------------------
// La llama la app con la sesión del usuario:
//   { accion: 'clave' }                     → devuelve la clave pública VAPID
//   { accion: 'avisar', version: '<id>' }   → avisa a la otra persona:
//       · si llama el asesor (dejó una observación) → al alumno
//       · si llama el alumno (subió una versión)    → a su asesor
//
// Seguridad
// · La versión se consulta con la sesión de quien llama: si las reglas RLS
//   no le dejan verla, no se envía nada.
// · El destinatario lo decide esta función, no el navegador.
// · Solo se envía a los servicios de push de los navegadores (lista HOSTS).
//
// Secretos que hay que configurar en Supabase (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT (mailto:tu-correo)
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los pone
// Supabase automáticamente.
// ==========================================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Servicios de push de Chrome/Edge/Android, Firefox, Windows y Safari/iPhone
const HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const extra = (Deno.env.get('PUSH_HOSTS_EXTRA') || '').split(',').filter(Boolean); // solo para pruebas locales
const permitido = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    return (url.protocol === 'https:' && HOSTS.some((h) => h.test(url.hostname))) || extra.some((e) => endpoint.startsWith(e));
  } catch {
    return false;
  }
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const publica = Deno.env.get('VAPID_PUBLIC_KEY');
  const privada = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publica || !privada) return responder({ error: 'Faltan las claves VAPID en los secretos de la función.' }, 500);

  const { accion, version } = await req.json().catch(() => ({}));
  if (accion === 'clave') return responder({ clave: publica });
  if (accion !== 'avisar' || typeof version !== 'string') return responder({ error: 'Petición no válida.' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await usuario.auth.getUser();
  if (!user) return responder({ error: 'Tu sesión terminó.' }, 401);

  // Con la sesión de quien llama: si no puede ver la versión, no hay aviso
  const { data: v } = await usuario
    .from('tesina_versiones')
    .select('id, numero, alumno_id, nombre_archivo, estado')
    .eq('id', version)
    .maybeSingle();
  if (!v) return responder({ error: 'No tienes acceso a esa versión.' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let destinatario: string;
  let aviso: { titulo: string; texto: string; url: string };

  if (user.id === v.alumno_id) {
    // El alumno subió una versión: se avisa a su asesor
    const { data: asignacion } = await admin.from('asignaciones_asesor').select('asesor_id').eq('alumno_id', v.alumno_id).maybeSingle();
    const { data: alumno } = await admin.from('alumnos').select('nombre').eq('id', v.alumno_id).maybeSingle();
    if (!asignacion) return responder({ enviadas: 0, motivo: 'El alumno no tiene asesor asignado.' });
    destinatario = asignacion.asesor_id;
    aviso = {
      titulo: `Nueva versión de ${alumno?.nombre ?? 'tu alumno'}`,
      texto: `Subió la versión ${v.numero} de su tesina (${v.nombre_archivo}). Ya puedes revisarla.`,
      url: `asesor.html#alumno/${v.alumno_id}`,
    };
  } else {
    // El asesor dejó una observación: se avisa al alumno
    destinatario = v.alumno_id;
    aviso = {
      titulo: 'Tu asesor revisó tu tesina',
      texto: `Dejó una observación en la versión ${v.numero}. Estado: ${v.estado}.`,
      url: 'alumno.html#tesina',
    };
  }

  const { data: suscripciones } = await admin.from('suscripciones_push').select('id, endpoint, p256dh, auth').eq('usuario_id', destinatario);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:estadias@example.com', publica, privada);

  let enviadas = 0;
  for (const s of suscripciones ?? []) {
    if (!permitido(s.endpoint)) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...aviso, etiqueta: `tesina-${v.id}` }), { TTL: 86400 });
      enviadas++;
    } catch (error) {
      // 404/410: el navegador canceló la suscripción; se borra
      const estado = (error as { statusCode?: number }).statusCode;
      if (estado === 404 || estado === 410) await admin.from('suscripciones_push').delete().eq('id', s.id);
    }
  }
  return responder({ enviadas });
});
