// Configuração pública do app. Estes dois valores ficam em
// Supabase > Project Settings > API (Project URL e a chave "anon public").
// A chave anon pode ficar aqui: quem protege os dados são as regras do banco (schema.sql).
// NUNCA coloque aqui a chave service_role nem a chave da Anthropic.
window.CAMOCIM_CONFIG = {
  supabaseUrl: "https://dipobcbjpqpgpxejnnvh.supabase.co",
  supabaseAnonKey: "",   // ex.: "eyJhbGciOi..."
  apiGerar: "/api/gerar",
  contato: ""            // ex.: "WhatsApp (95) 9 0000-0000" — aparece para quem aguarda liberação
};
