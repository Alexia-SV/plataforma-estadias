-- ==========================================================================
-- fechas-datos-prueba.sql — Reparte las fechas de los datos de prueba
-- --------------------------------------------------------------------------
-- PASO 3 de 3: ejecútalo en el SQL Editor DESPUÉS de
--   node supabase/sembrar-datos-prueba.mjs
--
-- La base de datos guarda la fecha real en que se sube cada versión, así que
-- todos los datos de prueba quedan con la fecha del día en que se sembraron.
-- Este script les pone fechas realistas del periodo septiembre–octubre
-- 2026 (las mismas que aparecen en la portada de cada tesina).
-- Solo modifica las cuentas @sigep-pruebas.mx. Se puede ejecutar varias veces.
-- ==========================================================================

-- 1. Versiones de la tesina y la observación de cada una (hora de Puebla, UTC-6)
with plan(matricula, numero, subida, observada) as (values
  ('9900000001', 1, timestamptz '2026-09-14 10:20-06', timestamptz '2026-09-16 12:05-06'),
  ('9900000001', 2, timestamptz '2026-09-25 18:40-06', timestamptz '2026-09-28 09:15-06'),
  ('9900000001', 3, timestamptz '2026-10-09 21:10-06', timestamptz '2026-10-12 11:30-06'),
  ('9900000002', 1, timestamptz '2026-09-22 16:05-06', timestamptz '2026-09-24 10:40-06'),
  ('9900000002', 2, timestamptz '2026-10-08 19:25-06', null),
  ('9900000003', 1, timestamptz '2026-10-19 13:50-06', null),
  ('9900000005', 1, timestamptz '2026-09-16 09:30-06', timestamptz '2026-09-18 17:20-06'),
  ('9900000005', 2, timestamptz '2026-09-30 20:15-06', timestamptz '2026-10-02 10:05-06'),
  ('9900000006', 1, timestamptz '2026-09-21 11:45-06', timestamptz '2026-09-23 13:10-06'),
  ('9900000006', 2, timestamptz '2026-10-03 22:30-06', timestamptz '2026-10-06 09:50-06'),
  ('9900000006', 3, timestamptz '2026-10-17 18:00-06', timestamptz '2026-10-18 08:45-06'),
  ('9900000007', 1, timestamptz '2026-10-05 15:20-06', timestamptz '2026-10-07 12:40-06')
),
versiones as (
  update public.tesina_versiones v
     set subida_en = p.subida
    from public.alumnos a, plan p
   where a.id = v.alumno_id and a.correo like '%@sigep-pruebas.mx'
     and p.matricula = a.matricula and p.numero = v.numero
  returning v.id, p.observada
)
update public.tesina_observaciones o
   set creado_en = v.observada
  from versiones v
 where o.version_id = v.id and v.observada is not null;

-- 2. Registro de las cuentas y asignación de asesores
update public.asesores
   set creado_en = timestamptz '2026-08-25 09:00-06'
 where correo like '%@sigep-pruebas.mx';

update public.alumnos
   set creado_en = timestamptz '2026-09-01 10:00-06' + (right(matricula, 1)::int * interval '13 hours')
 where correo like '%@sigep-pruebas.mx';

update public.asignaciones_asesor g
   set asignado_en = timestamptz '2026-09-08 09:30-06' + (right(a.matricula, 1)::int * interval '20 minutes')
  from public.alumnos a
 where a.id = g.alumno_id and a.correo like '%@sigep-pruebas.mx';

update auth.users u
   set created_at = x.fecha
  from (select id, creado_en as fecha from public.alumnos where correo like '%@sigep-pruebas.mx'
        union all
        select id, creado_en from public.asesores where correo like '%@sigep-pruebas.mx') x
 where u.id = x.id;

-- 3. Resultado: cada versión con su fecha
select a.nombre                                        as alumno,
       'v' || v.numero                                 as version,
       v.estado,
       to_char(v.subida_en at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI') as subida,
       coalesce(to_char(max(o.creado_en) at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI'), '—') as observacion
from public.tesina_versiones v
join public.alumnos a on a.id = v.alumno_id
left join public.tesina_observaciones o on o.version_id = v.id
where a.correo like '%@sigep-pruebas.mx'
group by a.nombre, v.numero, v.estado, v.subida_en
order by v.subida_en;
