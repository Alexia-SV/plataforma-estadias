// ==========================================================================
// sembrar-datos-prueba.mjs — Versiones de tesina y observaciones de prueba
// --------------------------------------------------------------------------
// PASO 2 de 3 (antes ejecuta supabase/datos-prueba.sql en el SQL Editor;
// después, supabase/fechas-datos-prueba.sql).
// Uso, desde la carpeta del proyecto:   node supabase/sembrar-datos-prueba.mjs
//
// · Usa la URL y la clave publicable de js/config.js (no necesita la secreta).
// · Entra como cada alumno de prueba para subir sus versiones y como cada
//   asesor para dejar sus observaciones, igual que en el portal.
// · Las tesinas son los PDF de supabase/datos-prueba/ (3 o 4 páginas cada una).
// · Si un alumno ya tiene versiones, lo omite: se puede ejecutar de nuevo.
// · No necesita instalar nada: solo Node 18 o superior.
// ==========================================================================
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const CARPETA_PDF = new URL('./datos-prueba/', import.meta.url);

const config = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const URL_SB = process.env.SUPABASE_URL || config.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
const CLAVE = process.env.SUPABASE_KEY || config.match(/supabaseKey:\s*'([^']+)'/)?.[1];
const CONTRASENA = 'Prueba2026';
const ASESOR1 = 'prueba.asesor1@sigep-pruebas.mx';
const ASESOR2 = 'prueba.asesor2@sigep-pruebas.mx';
const REQ = 'Requiere corrección';
const APR = 'Aprobada';

// --------------------------------------------------------------------------
// Plan: qué versiones sube cada alumno y qué responde su asesor
// --------------------------------------------------------------------------
const PLAN = [
  {
    correo: 'prueba.alumno01@sigep-pruebas.mx', asesor: ASESOR1, apellido: 'Ramirez',
    titulo: 'Sistema de inventarios para una PyME de alimentos',
    versiones: [
      { comentario: 'Primer borrador: introducción y planteamiento del problema.',
        obs: ['El planteamiento es claro, pero faltan los objetivos específicos y la justificación.', REQ] },
      { comentario: 'Agregué los objetivos específicos y la justificación.',
        obs: ['Bien. Ahora corrige las citas: deben ir en formato APA 7.', REQ] },
      { comentario: 'Corregí todas las citas a APA 7 y agregué las conclusiones.',
        obs: ['Excelente trabajo. La tesina queda aprobada.', APR] },
    ],
  },
  {
    correo: 'prueba.alumno02@sigep-pruebas.mx', asesor: ASESOR1, apellido: 'Hernandez',
    titulo: 'Aplicación móvil para el control de mantenimiento industrial',
    versiones: [
      { comentario: 'Capítulos 1 y 2.', obs: ['El marco teórico necesita al menos cinco fuentes recientes.', REQ] },
      { comentario: 'Amplié el marco teórico con seis fuentes de 2022 a 2026.' },
    ],
  },
  {
    correo: 'prueba.alumno03@sigep-pruebas.mx', asesor: ASESOR1, apellido: 'Flores',
    titulo: 'Tablero de indicadores de calidad en una línea de producción',
    versiones: [{ comentario: 'Primera entrega completa de la tesina.' }],
  },
  // prueba.alumno04: con asesor, pero todavía sin entregas
  {
    correo: 'prueba.alumno05@sigep-pruebas.mx', asesor: ASESOR2, apellido: 'Castillo',
    titulo: 'Plataforma web de reservaciones para un hotel boutique',
    versiones: [
      { comentario: 'Borrador con la metodología.', obs: ['Describe mejor la población y la muestra del estudio.', REQ] },
      { comentario: 'Detallé la muestra y agregué el cuestionario en los anexos.',
        obs: ['Aprobada. Muy buen análisis de resultados.', APR] },
    ],
  },
  {
    correo: 'prueba.alumno06@sigep-pruebas.mx', asesor: ASESOR2, apellido: 'Ruiz',
    titulo: 'Monitoreo de consumo energético con IoT',
    versiones: [
      { comentario: 'Introducción y diagrama de la arquitectura.', obs: ['Falta el diagrama eléctrico de los sensores.', REQ] },
      { comentario: 'Agregué el diagrama eléctrico.', obs: ['Las gráficas de consumo no tienen unidades.', REQ] },
      { comentario: 'Corregí las gráficas y agregué la tabla de costos.',
        obs: ['Recibido. La reviso esta semana.', null] },
    ],
  },
  {
    correo: 'prueba.alumno07@sigep-pruebas.mx', asesor: ASESOR2, apellido: 'Morales',
    titulo: 'Rediseño del proceso de compras de una empresa automotriz',
    versiones: [{ comentario: 'Versión final revisada con mi asesor de la empresa.', obs: ['Aprobada sin cambios.', APR] }],
  },
  // prueba.alumno08: sin asesor asignado y sin entregas
];

// --------------------------------------------------------------------------
// Peticiones a Supabase (Auth, Storage y REST)
// --------------------------------------------------------------------------
async function pedir(ruta, { metodo = 'GET', token, cuerpo, tipo = 'application/json', extra = {} } = {}) {
  const r = await fetch(`${URL_SB}${ruta}`, {
    method: metodo,
    headers: { apikey: CLAVE, Authorization: `Bearer ${token || CLAVE}`, 'Content-Type': tipo, ...extra },
    body: cuerpo === undefined ? undefined : (tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo),
  });
  const texto = await r.text();
  let datos; try { datos = JSON.parse(texto); } catch { datos = texto; }
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0]} → ${r.status} ${datos?.message || datos?.msg || datos?.error_description || texto}`);
  return datos;
}

async function entrar(correo) {
  const s = await pedir('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: correo, password: CONTRASENA } });
  return { token: s.access_token, id: s.user.id };
}

// --------------------------------------------------------------------------
// Siembra
// --------------------------------------------------------------------------
if (!URL_SB || !CLAVE) {
  console.error('No se encontraron la URL y la clave de Supabase en js/config.js.');
  process.exit(1);
}
console.log(`\nSembrando datos de prueba en ${URL_SB}\n`);

const asesores = {};
let versiones = 0;
let observaciones = 0;

for (const alumno of PLAN) {
  const sesion = await entrar(alumno.correo);
  const yaTiene = await pedir(`/rest/v1/tesina_versiones?alumno_id=eq.${sesion.id}&select=id`, { token: sesion.token });
  if (yaTiene.length) {
    console.log(`  · ${alumno.correo}: ya tiene ${yaTiene.length} ${yaTiene.length === 1 ? 'versión' : 'versiones'}, se omite.`);
    continue;
  }
  const [perfil] = await pedir(`/rest/v1/alumnos?id=eq.${sesion.id}&select=nombre,matricula`, { token: sesion.token });
  asesores[alumno.asesor] ||= await entrar(alumno.asesor);

  for (const [i, v] of alumno.versiones.entries()) {
    const numero = i + 1;
    const nombreArchivo = `Tesina_${alumno.apellido}_v${numero}.pdf`;
    const archivo = readFileSync(new URL(nombreArchivo, CARPETA_PDF));

    // 1) El alumno sube el archivo a su carpeta y lo registra como versión
    const ruta = `${sesion.id}/${randomUUID()}.pdf`;
    await pedir(`/storage/v1/object/tesinas/${ruta}`, { metodo: 'POST', token: sesion.token, cuerpo: archivo, tipo: 'application/pdf' });
    const [version] = await pedir('/rest/v1/tesina_versiones', {
      metodo: 'POST', token: sesion.token, extra: { Prefer: 'return=representation' },
      cuerpo: {
        alumno_id: sesion.id, numero: 1, archivo_path: ruta, nombre_archivo: nombreArchivo,
        tipo: 'application/pdf', tamano_bytes: archivo.length, comentario: v.comentario,
      },
    });
    versiones++;

    // 2) El asesor deja su observación (y cambia el estado si corresponde)
    let detalle = 'En revisión';
    if (v.obs) {
      const [texto, estado] = v.obs;
      await pedir('/rest/v1/rpc/observar_version', {
        metodo: 'POST', token: asesores[alumno.asesor].token,
        cuerpo: { p_version: version.id, p_texto: texto, p_estado: estado },
      });
      observaciones++;
      detalle = estado || 'En revisión (con observación)';
    }
    console.log(`  ✔ ${perfil.nombre} · versión ${version.numero} · ${detalle}`);
  }
}

console.log(`\nListo: ${versiones} versiones y ${observaciones} observaciones nuevas.`);
if (versiones) console.log('Último paso: ejecuta supabase/fechas-datos-prueba.sql en el SQL Editor para repartir las fechas.');
console.log('Cuentas: prueba.alumno01…08@sigep-pruebas.mx y prueba.asesor1…2@sigep-pruebas.mx · contraseña Prueba2026');
