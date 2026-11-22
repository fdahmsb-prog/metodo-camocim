# Robô de provas anteriores — Método Camocim

Transforma uma prova de concurso (PDF oficial da banca) em questões prontas para o Camocim.

O que ele faz:
1. Baixa o caderno de provas e o gabarito definitivo pelos links que você informar.
2. Lê o PDF em duas colunas e separa as questões, tanto Certo/Errado (Cebraspe) quanto múltipla escolha (FGV, FCC, Vunesp e outras).
3. Aplica o gabarito oficial e tira as questões anuladas.
4. Se você quiser, escreve com a IA o comentário, o fundamento, a disciplina e o assunto de cada questão.
5. Grava o arquivo `.json` e um relatório em `questoes/pendentes/`.

O robô **não importa nada sozinho no app**. Você revisa e importa em Ajustes → Importar questões.

## Arquivos

| Arquivo | Onde fica no repositório metodo-camocim |
|---|---|
| `robo.py` | `robo/robo.py` |
| `requirements.txt` | `robo/requirements.txt` |
| `robo-provas.yml` | `.github/workflows/robo-provas.yml` |

## Configurar uma vez

1. No GitHub, abra o repositório **metodo-camocim** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Nome: `ANTHROPIC_API_KEY`. Valor: a mesma chave `sk-ant-...` que está no Vercel. Clique em **Add secret**.
3. (Opcional) Na aba **Variables**, crie `ANTHROPIC_MODEL` para escolher outro modelo.

## Usar

1. No site oficial da banca, abra a página do concurso. Com o botão direito, copie o link do **caderno de provas** e do **gabarito definitivo** do cargo. Na Cebraspe, os conhecimentos básicos e os específicos costumam ter gabaritos separados: copie os dois.
2. No GitHub, vá em **Actions** → **Robô de provas anteriores** → **Run workflow**.
3. Cole os links nos campos **prova** e **gabarito** (se houver mais de um, separe por espaço). Preencha banca, ano, órgão e cargo e clique em **Run workflow**.
4. Em alguns minutos o robô termina. Clique na execução para ver o relatório. O arquivo `.json` fica na pasta `questoes/pendentes` do repositório e também em **Artifacts**.
5. Baixe o `.json`, leia o relatório e importe no Camocim.

Para só ver os PDFs de uma página, preencha apenas o campo **pagina**. Alguns sites montam a lista com JavaScript e o robô não enxerga os links; nesse caso, copie os links à mão.

## O relatório avisa

- Quais questões foram anuladas e ficaram de fora.
- Números de questões que não foram encontrados na prova.
- Questões sem resposta no gabarito (por exemplo, faltou o gabarito dos conhecimentos básicos).
- Questões com fórmula ou símbolo mal lido: corrija o enunciado antes de importar.
- Questões que dependem de figura, gráfico ou tabela: o app não mostra imagens, então descreva a figura no enunciado.

## Limites

- Só PDFs com texto. Provas escaneadas (imagem) precisam do Importar PDF do próprio app, que tem leitura por OCR.
- Fórmulas matemáticas costumam sair mal; o relatório aponta quais são.
- Os comentários da IA partem do gabarito oficial, mas devem ser revisados antes de vender, principalmente os de legislação estadual e os que citam artigo de lei.

## Cuidados

- Use só os sites oficiais das bancas. Não copie questões nem comentários de TecConcursos, Qconcursos ou de cursinhos: os termos desses sites proíbem e os comentários têm autor.
- Antes de vender, confirme com um advogado o uso comercial de provas de concurso.

## Rodar no computador (opcional)

```
pip install -r robo/requirements.txt
python robo/robo.py converter --prova LINK_OU_ARQUIVO.pdf --gabarito LINK_OU_ARQUIVO.pdf --banca FGV --ano 2025 --orgao SEFAZ-PR --cargo "Auditor Fiscal"
```

Acrescente `--comentar` (com a variável `ANTHROPIC_API_KEY` definida) para gerar os comentários.
