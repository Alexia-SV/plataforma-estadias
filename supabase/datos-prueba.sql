-- ==========================================================================
-- datos-prueba.sql — 10 cuentas de prueba (8 alumnos y 2 asesores)
-- --------------------------------------------------------------------------
-- PASO 1 de 3. En Supabase → SQL Editor, pega todo este archivo y pulsa Run.
-- PASO 2 de 3. En una terminal, dentro de la carpeta del proyecto:
--                node supabase/sembrar-datos-prueba.mjs
--              (sube las tesinas en PDF y las observaciones del asesor)
-- PASO 3 de 3. En el SQL Editor, ejecuta supabase/fechas-datos-prueba.sql
--              (reparte las fechas entre septiembre y octubre de 2026)
--
-- · Todas las cuentas usan el dominio @sigep-pruebas.mx y la contraseña
--   Prueba2026. Las matrículas empiezan con 99 para no chocar con reales.
-- · Se puede ejecutar más de una vez: no duplica cuentas.
-- · Para quitarlas: supabase/borrar-datos-prueba.sql
-- Requisito: haber ejecutado antes esquema.sql y tesina.sql.
-- ==========================================================================

do $$
declare
  v_clave text := extensions.crypt('Prueba2026', extensions.gen_salt('bf'));
  v_id    uuid;
  r       record;
begin
  for r in
    select * from (values
      -- correo                              nombre                          matrícula     nivel
      ('prueba.asesor1@sigep-pruebas.mx',  'Dra. Mariana Torres Salgado',  null,         null),
      ('prueba.asesor2@sigep-pruebas.mx',  'Mtro. Ricardo Vega Morales',   null,         null),
      ('prueba.alumno01@sigep-pruebas.mx', 'Ana Lucía Ramírez Cruz',       '9900000001', 'Ingeniería'),
      ('prueba.alumno02@sigep-pruebas.mx', 'Bruno Hernández Ortega',       '9900000002', 'TSU'),
      ('prueba.alumno03@sigep-pruebas.mx', 'Camila Flores Aguilar',        '9900000003', 'Ingeniería'),
      ('prueba.alumno04@sigep-pruebas.mx', 'Diego Martínez Solís',         '9900000004', 'TSU'),
      ('prueba.alumno05@sigep-pruebas.mx', 'Elena Castillo Pérez',         '9900000005', 'Ingeniería'),
      ('prueba.alumno06@sigep-pruebas.mx', 'Fernando Ruiz Domínguez',      '9900000006', 'Ingeniería'),
      ('prueba.alumno07@sigep-pruebas.mx', 'Gabriela Morales Núñez',       '9900000007', 'TSU'),
      ('prueba.alumno08@sigep-pruebas.mx', 'Héctor Jiménez Rosas',         '9900000008', 'TSU')
    ) as t(correo, nombre, matricula, nivel)
  loop
    select u.id into v_id from auth.users u where lower(u.email) = r.correo;

    if v_id is null then
      v_id := gen_random_uuid();

      -- Cuenta confirmada (los alumnos traen sus datos como metadatos: el
      -- disparador de esquema.sql crea su renglón en la tabla alumnos)
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        r.correo, v_clave, now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        case when r.matricula is null
          then jsonb_build_object('nombre', r.nombre)
          else jsonb_build_object('nombre', r.nombre, 'matricula', r.matricula, 'nivel', r.nivel)
        end,
        now(), now(), '', '', '', ''
      );

      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (
        gen_random_uuid(), v_id, v_id::text, 'email',
        jsonb_build_object('sub', v_id::text, 'email', r.correo, 'email_verified', true),
        now(), now(), now()
      );
    end if;

    if r.matricula is null then
      perform public.hacer_asesor(r.correo, r.nombre);
    end if;
  end loop;

  -- Asignaciones: 4 alumnos por asesor; el alumno 08 se queda sin asesor
  perform public.asignar_asesor('9900000001', 'prueba.asesor1@sigep-pruebas.mx');
  perform public.asignar_asesor('9900000002', 'prueba.asesor1@sigep-pruebas.mx');
  perform public.asignar_asesor('9900000003', 'prueba.asesor1@sigep-pruebas.mx');
  perform public.asignar_asesor('9900000004', 'prueba.asesor1@sigep-pruebas.mx');
  perform public.asignar_asesor('9900000005', 'prueba.asesor2@sigep-pruebas.mx');
  perform public.asignar_asesor('9900000006', 'prueba.asesor2@sigep-pruebas.mx');
  perform public.asignar_asesor('9900000007', 'prueba.asesor2@sigep-pruebas.mx');
end
$$;

-- Resumen de lo creado
select u.email as correo,
       coalesce(a.nombre, s.nombre) as nombre,
       case when a.id is not null then 'Alumno' when s.id is not null then 'Asesor' else '¿?' end as rol,
       a.matricula,
       a.nivel,
       (select x.nombre from public.asignaciones_asesor g join public.asesores x on x.id = g.asesor_id
         where g.alumno_id = a.id) as asesor_asignado
from auth.users u
left join public.alumnos a on a.id = u.id
left join public.asesores s on s.id = u.id
where u.email like '%@sigep-pruebas.mx'
order by rol desc, u.email;
