# Método Camocim — app de questões

Gera questões de concurso (Certo/Errado e múltipla escolha) a partir dos documentos enviados. Hospedado no Vercel.

| Arquivo | Para que serve |
|---|---|
| `index.html` | O app |
| `api/gerar.js` | Função do Vercel que guarda a chave da API fora do navegador |
| `vercel.json` | Dá até 5 minutos para a função gerar as questões |

Variáveis de ambiente no Vercel (Settings → Environment Variables):
- `ANTHROPIC_API_KEY` (obrigatória): a chave `sk-ant-...`
- `APP_SENHA` (opcional): senha pedida antes de gerar questões
- `ANTHROPIC_MODEL` (opcional): padrão `claude-sonnet-5-5`
