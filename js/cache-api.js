/* ==========================================================================
   cache-api.js — Caché de las respuestas de la API (Cache Storage)
   --------------------------------------------------------------------------
   Guarda en la caché "estadias-api" las respuestas que llegan de Supabase,
   para mostrarlas al instante y también sin conexión.

   Expone App.cacheApi con:
     guardar(clave, datos)   cache.put()    guarda un objeto como respuesta JSON
     leer(clave)             cache.match()  devuelve { datos, guardadoEn } o null
     borrar()                caches.delete() elimina toda la caché de la API
     resumen()               caches.keys() + cache.keys() + storage.estimate()

   Reglas: solo se guardan consultas (nunca contraseñas ni tokens) y la
   caché se borra al cerrar sesión (ver auth.js).
   ========================================================================== */
window.App = window.App || {};

App.cacheApi = (() => {
  'use strict';

  const NOMBRE = 'estadias-api';
  const disponible = 'caches' in window;

  // Las claves son direcciones dentro del sitio, p. ej. ./api/perfil.
  // No existen en el servidor: solo identifican la respuesta guardada.
  const url = (clave) => new URL(`api/${clave}`, document.baseURI).href;

  async function guardar(clave, datos) {
    if (!disponible) return;
    const cache = await caches.open(NOMBRE);
    const respuesta = new Response(JSON.stringify(datos), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Guardado-En': new Date().toISOString(),
      },
    });
    await cache.put(url(clave), respuesta);
  }

  async function leer(clave) {
    if (!disponible) return null;
    const respuesta = await caches.match(url(clave), { cacheName: NOMBRE });
    if (!respuesta) return null;
    return {
      datos: await respuesta.json(),
      guardadoEn: respuesta.headers.get('X-Guardado-En'),
    };
  }

  async function borrar() {
    if (!disponible) return false;
    return caches.delete(NOMBRE);
  }

  // Descripción de cada caché del sitio para el panel "Datos guardados"
  const DESCRIPCION = [
    [/^estadias-v\d+$/, 'Archivos de la aplicación'],
    [/^estadias-fuentes$/, 'Tipografías'],
    [/^estadias-api$/, 'Respuestas de la API'],
  ];

  async function resumen() {
    if (!disponible) return { lista: [], usado: null, cuota: null };

    const nombres = await caches.keys();
    const lista = await Promise.all(nombres.map(async (nombre) => {
      const cache = await caches.open(nombre);
      const entradas = await cache.keys();
      const descripcion = DESCRIPCION.find(([patron]) => patron.test(nombre))?.[1] || 'Otra caché';
      return { nombre, descripcion, entradas: entradas.length };
    }));

    let usado = null;
    let cuota = null;
    if (navigator.storage?.estimate) {
      ({ usage: usado, quota: cuota } = await navigator.storage.estimate());
    }
    return { lista, usado, cuota };
  }

  return { NOMBRE, disponible, guardar, leer, borrar, resumen };
})();
