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
