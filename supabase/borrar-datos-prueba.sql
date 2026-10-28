-- ==========================================================================
-- borrar-datos-prueba.sql — Quita las 10 cuentas de prueba
-- --------------------------------------------------------------------------
-- Borra las cuentas @sigep-pruebas.mx y, en cascada, sus renglones en
-- alumnos, asesores, asignaciones_asesor, tesina_versiones,
-- tesina_observaciones y tesina_notas. No toca ninguna cuenta real.
--
-- Los archivos quedan en Storage: el resultado de esta consulta lista las
-- carpetas que debes borrar en Storage → tesinas y Storage → voz
-- (selecciónalas y pulsa Delete). Una carpeta solo aparece si ese alumno
-- tiene archivos en ese bucket.
-- ==========================================================================
with borradas as (
  delete from auth.users
  where email like '%@sigep-pruebas.mx'
  returning id, email
)
select b.email as cuenta_borrada,
       case when exists (select 1 from storage.objects o
                          where o.bucket_id = 'tesinas' and o.name like b.id::text || '/%')
            then b.id::text else '—' end as carpeta_en_tesinas,
       case when exists (select 1 from storage.objects o
                          where o.bucket_id = 'voz' and o.name like b.id::text || '/%')
            then b.id::text else '—' end as carpeta_en_voz
from borradas b
order by b.email;
