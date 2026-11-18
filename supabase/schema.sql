-- =============================================================
-- Método Camocim Concursos — banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run
-- =============================================================

-- ---------- Perfis dos alunos ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  nome        text,
  status      text not null default 'pendente' check (status in ('pendente','ativo','bloqueado')),
  role        text not null default 'aluno'    check (role in ('aluno','admin')),
  validade    date,                 -- vazio = acesso sem data de término
  observacao  text,
  criado_em   timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém se cadastra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', ''));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Funções de apoio às regras de acesso
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.acesso_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'admin' or (status = 'ativo' and (validade is null or validade >= current_date)))
  );
$$;

-- O aluno não pode se promover a admin nem se liberar sozinho
create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() vazio = SQL Editor do Supabase ou servidor (service_role): pode alterar
  if auth.uid() is not null and not public.is_admin() then
    new.status := old.status;
    new.role := old.role;
    new.validade := old.validade;
    new.observacao := old.observacao;
  end if;
  return new;
end $$;

drop trigger if exists proteger_perfil on public.profiles;
create trigger proteger_perfil before update on public.profiles
  for each row execute function public.proteger_perfil();

-- ---------- Questões ----------
-- owner vazio = questão do banco geral (vale para todos os alunos ativos)
-- owner preenchido = questão particular do administrador (rascunho, fora do banco geral)
create table if not exists public.questoes (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid references auth.users(id) on delete cascade,
  dados      jsonb not null,
  criado_em  timestamptz not null default now()
);
create index if not exists questoes_owner_idx on public.questoes(owner);

-- ---------- Progresso de cada aluno ----------
create table if not exists public.estado (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- ---------- Documentos (legislação enviada) ----------
create table if not exists public.documentos (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  nome        text not null,
  texto       text not null,
  disciplina  text,
  criado_em   timestamptz not null default now()
);

-- ---------- Registro de uso da IA (controle de custo) ----------
create table if not exists public.geracoes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  qtd        int not null,
  criado_em  timestamptz not null default now()
);
create index if not exists geracoes_user_idx on public.geracoes(user_id, criado_em);

-- =============================================================
-- Permissões da API (necessárias quando "Automatically expose new tables"
-- está desligado). Quem vê o quê continua decidido pelas regras abaixo.
-- =============================================================
grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.questoes, public.estado, public.documentos to authenticated;
grant select on public.geracoes to authenticated;
grant execute on function public.is_admin(), public.acesso_ativo() to authenticated;

-- =============================================================
-- Regras de acesso (Row Level Security)
-- =============================================================
alter table public.profiles   enable row level security;
alter table public.questoes   enable row level security;
alter table public.estado     enable row level security;
alter table public.documentos enable row level security;
alter table public.geracoes   enable row level security;

drop policy if exists "perfil: ler o proprio ou admin" on public.profiles;
create policy "perfil: ler o proprio ou admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "perfil: editar o proprio ou admin" on public.profiles;
create policy "perfil: editar o proprio ou admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

drop policy if exists "questoes: ler" on public.questoes;
create policy "questoes: ler" on public.questoes
  for select using ((owner is null and public.acesso_ativo()) or owner = auth.uid() or public.is_admin());
drop policy if exists "questoes: criar" on public.questoes;
create policy "questoes: criar" on public.questoes
  for insert with check (public.is_admin());
drop policy if exists "questoes: alterar" on public.questoes;
create policy "questoes: alterar" on public.questoes
  for update using (owner = auth.uid() or public.is_admin());
drop policy if exists "questoes: excluir" on public.questoes;
create policy "questoes: excluir" on public.questoes
  for delete using (owner = auth.uid() or public.is_admin());

drop policy if exists "estado: so o dono" on public.estado;
create policy "estado: so o dono" on public.estado
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "documentos: so o dono" on public.documentos;
create policy "documentos: so o dono" on public.documentos
  for all using (owner = auth.uid() and public.is_admin()) with check (owner = auth.uid() and public.is_admin());

drop policy if exists "geracoes: ler a propria" on public.geracoes;
create policy "geracoes: ler a propria" on public.geracoes
  for select using (user_id = auth.uid() or public.is_admin());
-- inserções em geracoes são feitas só pelo servidor (/api/gerar), com a chave service_role

-- =============================================================
-- Depois de criar sua conta no app, rode a linha abaixo trocando o e-mail
-- para virar administrador:
--
--   update public.profiles set role = 'admin', status = 'ativo' where email = 'seu-email@exemplo.com';
-- =============================================================

-- =============================================================
-- Método Camocim — Fórum das questões
-- Rode no Supabase: SQL Editor > New query > Run (uma vez).
-- Pode rodar de novo sem problema.
-- =============================================================
create table if not exists public.comentarios (
  id          uuid primary key default gen_random_uuid(),
  questao_id  uuid not null references public.questoes(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  autor_nome  text,
  autor_admin boolean not null default false,
  texto       text not null check (char_length(texto) between 2 and 2000),
  criado_em   timestamptz not null default now()
);
create index if not exists comentarios_questao_idx on public.comentarios(questao_id, criado_em);

-- Autor, nome e etiqueta "Professor" vêm do perfil de quem escreve: o aluno não consegue se passar por outra pessoa
create or replace function public.preparar_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  select coalesce(nullif(nome, ''), split_part(email, '@', 1)) into new.autor_nome from public.profiles where id = auth.uid();
  new.autor_admin := public.is_admin();
  new.criado_em := now();
  return new;
end $$;

drop trigger if exists preparar_comentario on public.comentarios;
create trigger preparar_comentario before insert on public.comentarios
  for each row execute function public.preparar_comentario();

alter table public.comentarios enable row level security;
grant select, insert, delete on public.comentarios to authenticated;

-- Lê e escreve quem tem acesso ativo, só em questões que pode ver
drop policy if exists "comentarios: ler" on public.comentarios;
create policy "comentarios: ler" on public.comentarios
  for select using (public.acesso_ativo() and exists (select 1 from public.questoes q where q.id = questao_id));
drop policy if exists "comentarios: escrever" on public.comentarios;
create policy "comentarios: escrever" on public.comentarios
  for insert with check (user_id = auth.uid() and public.acesso_ativo() and exists (select 1 from public.questoes q where q.id = questao_id));
-- Apaga o próprio comentário; o administrador apaga qualquer um
drop policy if exists "comentarios: excluir" on public.comentarios;
create policy "comentarios: excluir" on public.comentarios
  for delete using (user_id = auth.uid() or public.is_admin());
