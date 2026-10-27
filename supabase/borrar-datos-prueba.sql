-- ==========================================================================
-- borrar-datos-prueba.sql — Quita las 10 cuentas de prueba
-- --------------------------------------------------------------------------
-- Borra las cuentas @sigep-pruebas.mx y, en cascada, sus renglones en
-- alumnos, asesores, asignaciones_asesor, tesina_versiones y
-- tesina_observaciones. No toca ninguna cuenta real.
--
-- Los archivos PDF quedan en Storage: el resultado de esta consulta lista
-- las carpetas que debes borrar en Storage → tesinas (selecciónalas y pulsa
-- Delete). Una carpeta solo aparece si ese alumno subió archivos.
-- ==========================================================================
with borradas as (
  delete from auth.users
  where email like '%@sigep-pruebas.mx'
  returning id, email
)
select b.email as cuenta_borrada,
       case when exists (select 1 from storage.objects o
                          where o.bucket_id = 'tesinas' and o.name like b.id::text || '/%')
            then b.id::text else '—' end as carpeta_para_borrar_en_storage
from borradas b
order by b.email;
