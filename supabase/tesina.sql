-- ==========================================================================
-- tesina.sql — Asesores y tesina con versiones (Supabase / PostgreSQL)
-- --------------------------------------------------------------------------
-- Requisito: haber ejecutado antes supabase/esquema.sql.
-- Cómo usarlo: en Supabase abre "SQL Editor", pega todo este archivo y pulsa
-- "Run". Se puede ejecutar más de una vez sin duplicar nada.
--
-- Contenido
--   1. Tablas: asesores, asignaciones_asesor, tesina_versiones,
--      tesina_observaciones
--   2. Funciones de apoyo para las reglas de seguridad
--   3. Reglas de seguridad (RLS) y permisos
--   4. Numeración automática de versiones
--   5. Observaciones del asesor (función observar_version)
--   6. Almacenamiento de archivos (bucket "tesinas")
--   7. Administración: hacer_asesor() y asignar_asesor()
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tablas
-- --------------------------------------------------------------------------
create table if not exists public.asesores (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null check (char_length(trim(nombre)) between 3 and 120),
  correo     text not null unique,
  creado_en  timestamptz not null default now()
);

-- Un alumno tiene un solo asesor; un asesor puede tener varios alumnos
create table if not exists public.asignaciones_asesor (
  alumno_id    uuid primary key references public.alumnos (id) on delete cascade,
  asesor_id    uuid not null references public.asesores (id) on delete cascade,
  asignado_en  timestamptz not null default now()
);

create index if not exists asignaciones_asesor_asesor_idx on public.asignaciones_asesor (asesor_id);

-- Cada archivo que sube el alumno es una versión nueva; nunca se reemplaza
create table if not exists public.tesina_versiones (
  id              uuid primary key default gen_random_uuid(),
  alumno_id       uuid not null references public.alumnos (id) on delete cascade,
  numero          integer not null check (numero > 0),
  archivo_path    text not null unique,
  nombre_archivo  text not null check (char_length(nombre_archivo) between 1 and 200),
  tipo            text not null check (tipo in (
                    'application/pdf',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  tamano_bytes    bigint not null check (tamano_bytes > 0 and tamano_bytes <= 10485760),
  comentario      text check (comentario is null or char_length(comentario) <= 500),
  estado          text not null default 'En revisión'
                    check (estado in ('En revisión', 'Aprobada', 'Requiere corrección')),
  subida_en       timestamptz not null default now(),
  unique (alumno_id, numero)
);

create table if not exists public.tesina_observaciones (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references public.tesina_versiones (id) on delete cascade,
  asesor_id        uuid not null references public.asesores (id) on delete cascade,
  texto            text not null check (char_length(trim(texto)) between 1 and 2000),
  estado_asignado  text check (estado_asignado in ('Aprobada', 'Requiere corrección')),
  creado_en        timestamptz not null default now()
);

create index if not exists tesina_observaciones_version_idx on public.tesina_observaciones (version_id);

comment on table public.tesina_versiones is 'Historial de versiones de la tesina de cada alumno (no se modifican ni se borran).';
comment on table public.tesina_observaciones is 'Observaciones del asesor sobre cada versión de la tesina.';

-- --------------------------------------------------------------------------
-- 2. Funciones de apoyo (se usan dentro de las reglas de seguridad)
-- --------------------------------------------------------------------------

-- ¿El usuario con sesión es el asesor asignado de ese alumno?
create or replace function public.es_asesor_de(p_alumno text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.asignaciones_asesor a
    where a.alumno_id::text = p_alumno and a.asesor_id = auth.uid()
  );
$$;

-- ¿Ese asesor es el asignado al alumno con sesión?
create or replace function public.es_mi_asesor(p_asesor uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.asignaciones_asesor a
    where a.alumno_id = auth.uid() and a.asesor_id = p_asesor
  );
$$;

revoke all on function public.es_asesor_de(text) from public, anon;
revoke all on function public.es_mi_asesor(uuid) from public, anon;
grant execute on function public.es_asesor_de(text) to authenticated;
grant execute on function public.es_mi_asesor(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 3. Reglas de seguridad (RLS) y permisos
-- --------------------------------------------------------------------------
alter table public.asesores enable row level security;
alter table public.asignaciones_asesor enable row level security;
alter table public.tesina_versiones enable row level security;
alter table public.tesina_observaciones enable row level security;

-- Asesores: cada asesor ve su registro y el alumno ve a su asesor asignado
drop policy if exists "consultar asesor" on public.asesores;
create policy "consultar asesor"
  on public.asesores for select
  to authenticated
  using (id = (select auth.uid()) or public.es_mi_asesor(id));

-- Asignaciones: las ven el alumno y el asesor involucrados
drop policy if exists "consultar asignacion" on public.asignaciones_asesor;
create policy "consultar asignacion"
  on public.asignaciones_asesor for select
  to authenticated
  using (alumno_id = (select auth.uid()) or asesor_id = (select auth.uid()));

-- Alumnos: además de su propio registro (esquema.sql), el asesor ve a sus alumnos
drop policy if exists "asesor consulta a sus alumnos" on public.alumnos;
create policy "asesor consulta a sus alumnos"
  on public.alumnos for select
  to authenticated
  using (public.es_asesor_de(id::text));

-- Versiones: las ven el alumno dueño y su asesor; solo el alumno agrega.
-- No hay reglas de UPDATE ni DELETE: el historial no se puede alterar.
drop policy if exists "consultar versiones" on public.tesina_versiones;
create policy "consultar versiones"
  on public.tesina_versiones for select
  to authenticated
  using (alumno_id = (select auth.uid()) or public.es_asesor_de(alumno_id::text));

drop policy if exists "alumno agrega version" on public.tesina_versiones;
create policy "alumno agrega version"
  on public.tesina_versiones for insert
  to authenticated
  with check (alumno_id = (select auth.uid()));

-- Observaciones: las ven el alumno dueño de la versión y su asesor.
-- Se crean solo con la función observar_version (punto 5).
drop policy if exists "consultar observaciones" on public.tesina_observaciones;
create policy "consultar observaciones"
  on public.tesina_observaciones for select
  to authenticated
  using (exists (
    select 1 from public.tesina_versiones v
    where v.id = version_id
      and (v.alumno_id = (select auth.uid()) or public.es_asesor_de(v.alumno_id::text))
  ));

revoke all on public.asesores, public.asignaciones_asesor,
              public.tesina_versiones, public.tesina_observaciones from anon;
grant select on public.asesores, public.asignaciones_asesor, public.tesina_observaciones to authenticated;
grant select, insert on public.tesina_versiones to authenticated;

-- --------------------------------------------------------------------------
-- 4. Numeración automática de versiones
--    El número, el tipo, el tamaño y el estado los fija la base de datos,
--    no el navegador: así no se pueden falsear.
-- --------------------------------------------------------------------------
create or replace function public.preparar_version_tesina()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_objeto record;
begin
  if new.alumno_id is distinct from auth.uid() then
    raise exception 'Solo puedes subir versiones de tu propia tesina.' using errcode = '42501';
  end if;

  if split_part(new.archivo_path, '/', 1) <> new.alumno_id::text then
    raise exception 'El archivo debe estar en tu carpeta.' using errcode = '42501';
  end if;

  select o.metadata into v_objeto
  from storage.objects o
  where o.bucket_id = 'tesinas' and o.name = new.archivo_path;

  if not found then
    raise exception 'No se encontró el archivo subido.' using errcode = 'P0002';
  end if;

  -- Datos reales del archivo guardado en Storage
  new.tipo := v_objeto.metadata ->> 'mimetype';
  new.tamano_bytes := (v_objeto.metadata ->> 'size')::bigint;

  -- Evita que dos subidas simultáneas tomen el mismo número
  perform pg_advisory_xact_lock(hashtext(new.alumno_id::text));
  select coalesce(max(v.numero), 0) + 1 into new.numero
  from public.tesina_versiones v
  where v.alumno_id = new.alumno_id;

  new.estado := 'En revisión';
  new.subida_en := now();
  new.comentario := nullif(trim(new.comentario), '');
  return new;
end;
$$;

drop trigger if exists antes_de_agregar_version on public.tesina_versiones;
create trigger antes_de_agregar_version
  before insert on public.tesina_versiones
  for each row execute function public.preparar_version_tesina();

-- --------------------------------------------------------------------------
-- 5. Observaciones del asesor
--    Guarda la observación y, si se indica, cambia el estado de la versión.
-- --------------------------------------------------------------------------
create or replace function public.observar_version(
  p_version uuid,
  p_texto   text,
  p_estado  text default null
)
returns public.tesina_observaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alumno uuid;
  v_obs    public.tesina_observaciones;
begin
  select v.alumno_id into v_alumno from public.tesina_versiones v where v.id = p_version;
  if v_alumno is null then
    raise exception 'La versión no existe.' using errcode = 'P0002';
  end if;

  if not public.es_asesor_de(v_alumno::text) then
    raise exception 'Solo el asesor asignado puede dejar observaciones.' using errcode = '42501';
  end if;

  if p_estado is not null and p_estado not in ('Aprobada', 'Requiere corrección') then
    raise exception 'Estado no válido.' using errcode = '22023';
  end if;

  insert into public.tesina_observaciones (version_id, asesor_id, texto, estado_asignado)
  values (p_version, auth.uid(), trim(p_texto), p_estado)
  returning * into v_obs;

  if p_estado is not null then
    update public.tesina_versiones set estado = p_estado where id = p_version;
  end if;

  return v_obs;
end;
$$;

revoke all on function public.observar_version(uuid, text, text) from public, anon;
grant execute on function public.observar_version(uuid, text, text) to authenticated;

-- --------------------------------------------------------------------------
-- 6. Almacenamiento de archivos: bucket privado "tesinas"
--    Solo PDF y Word, máximo 10 MB. Ruta: <id del alumno>/<archivo>
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tesinas', 'tesinas', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- El alumno sube archivos solo a su carpeta
drop policy if exists "alumno sube su tesina" on storage.objects;
create policy "alumno sube su tesina"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tesinas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.alumnos a where a.id = (select auth.uid()))
  );

-- El alumno descarga sus archivos y el asesor los de sus alumnos
drop policy if exists "descargar tesina" on storage.objects;
create policy "descargar tesina"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'tesinas'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.es_asesor_de((storage.foldername(name))[1])
    )
  );

-- El alumno solo puede borrar un archivo que no se registró como versión
-- (por ejemplo, si falló el registro después de subirlo)
drop policy if exists "alumno borra archivo sin version" on storage.objects;
create policy "alumno borra archivo sin version"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tesinas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.tesina_versiones v where v.archivo_path = objects.name)
  );

-- --------------------------------------------------------------------------
-- 7. Administración (se ejecutan solo desde el SQL Editor de Supabase)
--
--   Convertir una cuenta en asesor (créala antes en Authentication → Users):
--     select hacer_asesor('asesor@utpuebla.edu.mx', 'Nombre del asesor');
--
--   Asignar un asesor a un alumno:
--     select asignar_asesor('2311081277', 'asesor@utpuebla.edu.mx');
-- --------------------------------------------------------------------------
create or replace function public.hacer_asesor(p_correo text, p_nombre text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario record;
  v_nombre  text;
begin
  select u.id, u.email, u.raw_user_meta_data into v_usuario
  from auth.users u where lower(u.email) = lower(trim(p_correo));

  if not found then
    raise exception 'No existe una cuenta con el correo %. Créala primero en Authentication → Users.', p_correo;
  end if;

  if exists (select 1 from public.alumnos a where a.id = v_usuario.id) then
    raise exception 'La cuenta % pertenece a un alumno; usa otra cuenta para el asesor.', p_correo;
  end if;

  v_nombre := coalesce(nullif(trim(p_nombre), ''), v_usuario.raw_user_meta_data ->> 'nombre', split_part(v_usuario.email, '@', 1));

  insert into public.asesores (id, nombre, correo)
  values (v_usuario.id, v_nombre, lower(v_usuario.email))
  on conflict (id) do update set nombre = excluded.nombre;

  return format('Listo: %s (%s) ahora es asesor.', v_nombre, lower(v_usuario.email));
end;
$$;

create or replace function public.asignar_asesor(p_matricula text, p_correo_asesor text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alumno public.alumnos;
  v_asesor public.asesores;
begin
  select * into v_alumno from public.alumnos where matricula = trim(p_matricula);
  if not found then
    raise exception 'No hay un alumno con la matrícula %.', p_matricula;
  end if;

  select * into v_asesor from public.asesores where correo = lower(trim(p_correo_asesor));
  if not found then
    raise exception 'No hay un asesor con el correo %. Usa primero hacer_asesor().', p_correo_asesor;
  end if;

  insert into public.asignaciones_asesor (alumno_id, asesor_id)
  values (v_alumno.id, v_asesor.id)
  on conflict (alumno_id) do update set asesor_id = excluded.asesor_id, asignado_en = now();

  return format('Listo: %s (%s) quedó asignado a %s.', v_alumno.nombre, v_alumno.matricula, v_asesor.nombre);
end;
$$;

-- Solo el administrador (SQL Editor) puede ejecutar estas funciones
revoke all on function public.hacer_asesor(text, text) from public, anon, authenticated;
revoke all on function public.asignar_asesor(text, text) from public, anon, authenticated;
