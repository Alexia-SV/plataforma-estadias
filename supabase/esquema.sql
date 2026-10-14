-- ==========================================================================
-- esquema.sql — Base de datos del Portal del alumno (Supabase / PostgreSQL)
-- --------------------------------------------------------------------------
-- Cómo usarlo: en Supabase abre "SQL Editor", pega todo este archivo y
-- pulsa "Run". Se puede ejecutar más de una vez sin duplicar nada.
--
-- Las cuentas (correo y contraseña cifrada) las guarda Supabase Auth en
-- la tabla interna auth.users; esa tabla hace el papel de "usuarios".
-- Aquí se crea la tabla "alumnos" con los datos académicos de cada cuenta.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tabla alumnos
-- --------------------------------------------------------------------------
create table if not exists public.alumnos (
  id         uuid primary key references auth.users (id) on delete cascade,
  matricula  varchar(10) not null unique
             check (matricula ~ '^[0-9]{10}$'),
  nombre     text not null
             check (char_length(trim(nombre)) between 3 and 120),
  correo     text not null unique,
  nivel      text not null
             check (nivel in ('TSU', 'Ingeniería')),
  creado_en  timestamptz not null default now()
);

comment on table public.alumnos is 'Datos académicos de cada alumno registrado en el portal.';

-- --------------------------------------------------------------------------
-- 2. Seguridad por renglón (RLS): cada alumno solo ve y edita su registro
-- --------------------------------------------------------------------------
alter table public.alumnos enable row level security;

drop policy if exists "alumno consulta su registro" on public.alumnos;
create policy "alumno consulta su registro"
  on public.alumnos for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "alumno actualiza su registro" on public.alumnos;
create policy "alumno actualiza su registro"
  on public.alumnos for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No hay política de INSERT: el registro lo crea el disparador del punto 3.

-- Permisos de la API para usuarios con sesión (necesarios si el proyecto no
-- expone automáticamente las tablas nuevas; las políticas RLS siguen aplicando).
revoke all on public.alumnos from anon;
grant select, update on public.alumnos to authenticated;

-- --------------------------------------------------------------------------
-- 3. Al crear una cuenta, se crea automáticamente su renglón en alumnos
--    (los datos llegan desde el formulario de registro como metadatos)
-- --------------------------------------------------------------------------
create or replace function public.crear_registro_alumno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.alumnos (id, matricula, nombre, correo, nivel)
  values (
    new.id,
    new.raw_user_meta_data ->> 'matricula',
    trim(new.raw_user_meta_data ->> 'nombre'),
    lower(new.email),
    new.raw_user_meta_data ->> 'nivel'
  );
  return new;
end;
$$;

drop trigger if exists al_registrar_alumno on auth.users;
create trigger al_registrar_alumno
  after insert on auth.users
  for each row execute function public.crear_registro_alumno();

-- --------------------------------------------------------------------------
-- 4. Consulta pública: ¿la matrícula ya está registrada?
--    Solo responde verdadero o falso; no expone datos del alumno.
-- --------------------------------------------------------------------------
create or replace function public.matricula_disponible(p_matricula text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.alumnos where matricula = p_matricula
  );
$$;

revoke all on function public.matricula_disponible(text) from public;
grant execute on function public.matricula_disponible(text) to anon, authenticated;
