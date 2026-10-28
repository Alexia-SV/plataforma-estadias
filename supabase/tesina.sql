-- ==========================================================================
-- tesina.sql — Asesores y tesina con versiones (Supabase / PostgreSQL)
-- --------------------------------------------------------------------------
-- Requisito: haber ejecutado antes supabase/esquema.sql.
-- Cómo usarlo: en Supabase abre "SQL Editor", pega todo este archivo y pulsa
-- "Run". Se puede ejecutar más de una vez sin duplicar nada.
--
-- Contenido
--   1. Tablas: asesores, asignaciones_asesor, tesina_versiones,
--      tesina_observaciones, tesina_notas
--   2. Funciones de apoyo para las reglas de seguridad
--   3. Reglas de seguridad (RLS) y permisos
--   4. Numeración automática de versiones
--   5. Observaciones del asesor (función observar_version, con nota de voz)
--   6. Almacenamiento de archivos (buckets "tesinas" y "voz")
--   7. Administración: hacer_asesor() y asignar_asesor()
--   8. Tiempo real (Supabase Realtime) para versiones, observaciones y notas
--   9. Notificaciones push: suscripciones de cada dispositivo
--
-- Si tu base ya tenía una versión anterior de este archivo, vuelve a
-- ejecutarlo completo: agrega las columnas y tablas nuevas sin borrar datos.
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

-- Columnas agregadas después (se crean también en bases que ya existían)
-- · prerevision: resultado de la pre-revisión del formato que hizo la app
--   antes de subir el archivo (informativo para el asesor)
-- · audio_path / audio_segundos: nota de voz de la observación (bucket "voz")
alter table public.tesina_versiones add column if not exists prerevision jsonb;
alter table public.tesina_versiones drop constraint if exists tesina_versiones_prerevision_check;
alter table public.tesina_versiones add constraint tesina_versiones_prerevision_check
  check (prerevision is null or (jsonb_typeof(prerevision) = 'object' and pg_column_size(prerevision) <= 16384));

alter table public.tesina_observaciones add column if not exists audio_path text unique;
alter table public.tesina_observaciones add column if not exists audio_segundos integer
  check (audio_segundos is null or audio_segundos between 1 and 600);

-- Notas que el asesor deja sobre un punto exacto del documento:
-- en un PDF, la página y la posición (x, y de 0 a 1); en Word, el párrafo.
create table if not exists public.tesina_notas (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.tesina_versiones (id) on delete cascade,
  asesor_id   uuid not null references public.asesores (id) on delete cascade,
  pagina      integer check (pagina is null or pagina > 0),
  x           real check (x is null or x between 0 and 1),
  y           real check (y is null or y between 0 and 1),
  parrafo     integer check (parrafo is null or parrafo >= 0),
  extracto    text check (extracto is null or char_length(extracto) <= 200),
  texto       text not null check (char_length(trim(texto)) between 1 and 1000),
  creado_en   timestamptz not null default now(),
  constraint tesina_notas_lugar_check check (
    (pagina is not null and x is not null and y is not null and parrafo is null)
    or (parrafo is not null and pagina is null and x is null and y is null))
);

create index if not exists tesina_notas_version_idx on public.tesina_notas (version_id);

comment on table public.tesina_versiones is 'Historial de versiones de la tesina de cada alumno (no se modifican ni se borran).';
comment on table public.tesina_observaciones is 'Observaciones del asesor sobre cada versión de la tesina.';
comment on table public.tesina_notas is 'Notas del asesor ancladas a una página o párrafo de una versión.';

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
alter table public.tesina_notas enable row level security;

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

-- Notas ancladas: las ven el alumno dueño y su asesor; solo el asesor
-- asignado las agrega y cada asesor borra únicamente las suyas.
drop policy if exists "consultar notas" on public.tesina_notas;
create policy "consultar notas"
  on public.tesina_notas for select
  to authenticated
  using (exists (
    select 1 from public.tesina_versiones v
    where v.id = version_id
      and (v.alumno_id = (select auth.uid()) or public.es_asesor_de(v.alumno_id::text))
  ));

drop policy if exists "asesor agrega nota" on public.tesina_notas;
create policy "asesor agrega nota"
  on public.tesina_notas for insert
  to authenticated
  with check (
    asesor_id = (select auth.uid())
    and exists (
      select 1 from public.tesina_versiones v
      where v.id = version_id and public.es_asesor_de(v.alumno_id::text)
    )
  );

drop policy if exists "asesor borra su nota" on public.tesina_notas;
create policy "asesor borra su nota"
  on public.tesina_notas for delete
  to authenticated
  using (asesor_id = (select auth.uid()));

revoke all on public.asesores, public.asignaciones_asesor,
              public.tesina_versiones, public.tesina_observaciones, public.tesina_notas from anon;
grant select on public.asesores, public.asignaciones_asesor, public.tesina_observaciones to authenticated;
grant select, insert on public.tesina_versiones to authenticated;
grant select, insert, delete on public.tesina_notas to authenticated;

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
--    Guarda la observación (texto, nota de voz o ambos) y, si se indica,
--    cambia el estado de la versión.
-- --------------------------------------------------------------------------
-- La versión anterior no tenía nota de voz; se quita para que no haya dos
drop function if exists public.observar_version(uuid, text, text);

create or replace function public.observar_version(
  p_version        uuid,
  p_texto          text default null,
  p_estado         text default null,
  p_audio_path     text default null,
  p_audio_segundos integer default null
)
returns public.tesina_observaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alumno uuid;
  v_texto  text := nullif(trim(coalesce(p_texto, '')), '');
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

  if v_texto is null and p_audio_path is null then
    raise exception 'Escribe la observación o graba una nota de voz.' using errcode = '22023';
  end if;

  -- La nota de voz debe estar ya en la carpeta del alumno dentro del bucket "voz"
  if p_audio_path is not null then
    if split_part(p_audio_path, '/', 1) <> v_alumno::text then
      raise exception 'El archivo de la nota de voz no corresponde a este alumno.' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'voz' and o.name = p_audio_path) then
      raise exception 'No se encontró la nota de voz.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.tesina_observaciones (version_id, asesor_id, texto, estado_asignado, audio_path, audio_segundos)
  values (
    p_version, auth.uid(), coalesce(v_texto, 'Nota de voz'), p_estado, p_audio_path,
    case when p_audio_path is null then null else greatest(1, least(600, coalesce(p_audio_segundos, 1))) end
  )
  returning * into v_obs;

  if p_estado is not null then
    update public.tesina_versiones set estado = p_estado where id = p_version;
  end if;

  return v_obs;
end;
$$;

revoke all on function public.observar_version(uuid, text, text, text, integer) from public, anon;
grant execute on function public.observar_version(uuid, text, text, text, integer) to authenticated;

-- --------------------------------------------------------------------------
-- 6. Almacenamiento de archivos: buckets privados "tesinas" y "voz"
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

-- Notas de voz del asesor: bucket privado "voz", máximo 5 MB.
-- Ruta: <id del alumno>/<archivo>. Las graba el asesor asignado y las
-- escuchan él y el alumno.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voz', 'voz', false, 5242880,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "asesor sube nota de voz" on storage.objects;
create policy "asesor sube nota de voz"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'voz'
    and public.es_asesor_de((storage.foldername(name))[1])
  );

drop policy if exists "escuchar nota de voz" on storage.objects;
create policy "escuchar nota de voz"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'voz'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.es_asesor_de((storage.foldername(name))[1])
    )
  );

-- Si falla el registro de la observación, el asesor borra el audio sin usar
drop policy if exists "asesor borra nota de voz sin observacion" on storage.objects;
create policy "asesor borra nota de voz sin observacion"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'voz'
    and public.es_asesor_de((storage.foldername(name))[1])
    and not exists (select 1 from public.tesina_observaciones o where o.audio_path = objects.name)
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

-- --------------------------------------------------------------------------
-- 8. Tiempo real (Supabase Realtime)
--    La app se entera al instante cuando cambia una versión, una observación
--    o una nota, sin recargar. Realtime respeta las mismas reglas RLS: cada
--    quien solo recibe los cambios que puede ver.
-- --------------------------------------------------------------------------
do $$
declare
  v_tabla text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_tabla in array array['tesina_versiones', 'tesina_observaciones', 'tesina_notas'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabla) then
        execute format('alter publication supabase_realtime add table public.%I', v_tabla);
      end if;
    end loop;
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- 9. Notificaciones push
--    Cada dispositivo que acepta notificaciones guarda aquí su suscripción.
--    La función enviar-push (supabase/functions) las usa para avisar al
--    alumno cuando su asesor lo revisa, y al asesor cuando llega una versión.
-- --------------------------------------------------------------------------
create table if not exists public.suscripciones_push (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh      text not null check (char_length(p256dh) <= 200),
  auth        text not null check (char_length(auth) <= 100),
  creado_en   timestamptz not null default now()
);

create index if not exists suscripciones_push_usuario_idx on public.suscripciones_push (usuario_id);
comment on table public.suscripciones_push is 'Dispositivos que aceptaron notificaciones push (una fila por navegador).';

alter table public.suscripciones_push enable row level security;

-- Cada quien ve solo sus dispositivos; se registran y quitan con las funciones de abajo
drop policy if exists "ver mis suscripciones" on public.suscripciones_push;
create policy "ver mis suscripciones"
  on public.suscripciones_push for select
  to authenticated
  using (usuario_id = (select auth.uid()));

revoke all on public.suscripciones_push from anon, authenticated;
grant select on public.suscripciones_push to authenticated;

-- Registra (o reasigna, si en ese navegador entró otra cuenta) la suscripción
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Tu sesión terminó. Vuelve a iniciar sesión.' using errcode = '42501';
  end if;
  insert into public.suscripciones_push (usuario_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, creado_en = now();
end;
$$;

create or replace function public.quitar_push(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.suscripciones_push where endpoint = p_endpoint and usuario_id = auth.uid();
$$;

revoke all on function public.registrar_push(text, text, text) from public, anon;
revoke all on function public.quitar_push(text) from public, anon;
grant execute on function public.registrar_push(text, text, text) to authenticated;
grant execute on function public.quitar_push(text) to authenticated;
