// Configuração pública do app. Estes dois valores ficam em
// Supabase > Project Settings > API (Project URL e a chave "anon public").
// A chave anon pode ficar aqui: quem protege os dados são as regras do banco (schema.sql).
// NUNCA coloque aqui a chave service_role nem a chave da Anthropic.
window.CAMOCIM_CONFIG = {
  supabaseUrl: "https://dipobcbjpqpgpxejnnvh.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpcG9iY2JqcHFwZ3B4ZWpubnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MDkzNjYsImV4cCI6MjExMDA4NTM2Nn0.oRR5gPyoMFgXjAcFbPdQ1PMLQ7tqFMDeIOpTo0zW6Uk",
  apiGerar: "/api/gerar",
  contato: ""            // ex.: "WhatsApp (95) 9 0000-0000" — aparece para quem aguarda liberação
};
