# Método Camocim Concursos — como colocar no ar

App de questões com login, progresso salvo na nuvem e liberação manual de alunos.
Só o administrador gera e cadastra questões; os alunos resolvem. Assim o custo de IA fica sob seu controle.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O app (telas do aluno e do administrador) |
| `config.js` | Endereço e chave pública do Supabase, contato de suporte |
| `api/gerar.js` | Servidor que gera questões com IA (Vercel), só para o administrador |
| `package.json` | Configuração mínima para o Vercel |
| `supabase/schema.sql` | Tabelas e regras de acesso do banco |
| `supabase/seed.sql` | 28 questões-modelo (exemplos, não são de provas reais) |

## Passo 1 — Supabase (banco de dados e login)

1. Crie uma conta em supabase.com e clique em **New project**. Escolha a região **South America (São Paulo)** e anote a senha do banco.
2. No menu lateral, abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Faça o mesmo com `supabase/seed.sql`, para carregar as questões-modelo.
4. Em **Authentication → URL Configuration**, coloque em **Site URL** o endereço do app no Vercel (ex.: `https://metodo-camocim.vercel.app`). Volte aqui depois do Passo 3, quando souber o endereço.
5. Em **Authentication → Providers → Email**, decida se o aluno precisa confirmar o e-mail. Para testar, você pode desligar a opção *Confirm email*.
6. Em **Project Settings → API**, copie:
   - **Project URL** e a chave **anon public**, que vão para o `config.js`;
   - a chave **service_role**, que vai só para o Vercel (Passo 3). Ela é secreta.

## Passo 2 — config.js

Preencha:

```js
window.CAMOCIM_CONFIG = {
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseAnonKey: "SUA-CHAVE-ANON",
  apiGerar: "/api/gerar",
  contato: "WhatsApp (95) 9 0000-0000"
};
```

## Passo 3 — GitHub e Vercel

1. Crie um repositório no GitHub (conta `fdahmsb-prog`), por exemplo `metodo-camocim`, e envie todos os arquivos desta pasta mantendo a estrutura (`api/` e `supabase/`).
2. No Vercel: **Add New → Project**, importe o repositório e clique em **Deploy**. Não precisa de comando de build.
3. Em **Settings → Environment Variables**, cadastre:

| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | sua chave da Anthropic (console.anthropic.com) |
| `SUPABASE_URL` | o Project URL do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave service_role do Supabase |
| `ANTHROPIC_MODEL` | opcional: padrão `claude-sonnet-5-5` |

4. Clique em **Deployments → Redeploy** para as variáveis valerem.
5. Para vender, o plano do Vercel precisa ser o **Pro**: o gratuito (Hobby) não permite uso comercial.

## Passo 4 — Virar administrador

1. Abra o app e crie sua conta em **Criar conta**.
2. No Supabase, **SQL Editor**, rode trocando o e-mail:

```sql
update public.profiles set role = 'admin', status = 'ativo' where email = 'seu-email@exemplo.com';
```

3. Saia e entre de novo. Vai aparecer o menu **Administração**.

## Cadernos de questões (novo)

- Menu **Cadernos**: o aluno escolhe disciplina, assunto, banca, ano, origem, tipo, situação (não resolvidas, erradas, marcadas), quantidade e ordem, e cria um caderno com nome.
- O caderno guarda onde o aluno parou, mostra o mapa de acertos e erros e permite **Refazer as erradas** (gera um caderno só com elas) ou **Recomeçar do zero**.
- Fica salvo na nuvem junto com o progresso do aluno (tabela `estado`). Não precisa mudar o banco.
- **Enviar ao Farol**: manda as questões resolvidas para o Farol da Aprovação (controle de estudos). Cada questão é enviada uma vez só. O simulado também tem esse botão.
- **Copiar link**: gera um link que abre o caderno direto (só funciona na conta de quem criou).
- A tela Questões ganhou o filtro **Assunto**.

## Como funciona a venda (por enquanto, sem pagamento automático)

1. O aluno cria a conta e fica **Aguardando liberação**. A tela mostra o seu contato.
2. Você recebe o pagamento (Pix, por exemplo).
3. Em **Administração**, clique em **Liberar 30 dias**, **1 ano** ou **Sem prazo**. Liberar de novo soma o prazo à data atual de vencimento.
4. Quando o prazo vence, o aluno vê **Acesso vencido**, mas o histórico dele fica guardado para quando renovar.

## O que fica para cada um

- **Banco geral:** questões sem dono, visíveis para todos os alunos ativos. Só o administrador cria, importa, gera ou edita. Ao gerar ou importar, "Banco geral" já vem marcado.
- **Alunos:** resolvem, fazem simulados, revisam e anotam. Não veem o menu Legislação, não cadastram, não importam e não usam a IA. O banco de dados também bloqueia isso, não só a tela.
- **Progresso:** respostas, revisões, simulados e anotações de cada aluno ficam na tabela `estado`, só para o dono.
- **Custo da IA:** só existe quando você gera questões com IA, por volta de US$ 0,005 cada. O painel de administração mostra o total dos últimos 30 dias. O número de alunos não aumenta esse custo. O gerador offline, também só seu, é gratuito.

## Segurança

- A chave anon no `config.js` é pública por natureza; quem protege os dados são as regras (RLS) do `schema.sql`.
- A chave **service_role** e a chave da **Anthropic** ficam apenas nas variáveis do Vercel. Nunca as coloque no `config.js` nem no GitHub.
- O aluno não consegue se liberar nem virar administrador: o banco ignora essas alterações quando não vêm de um administrador.
