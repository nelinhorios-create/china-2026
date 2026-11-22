// Configuração pública do app. Estes valores podem ficar no repositório:
// a chave "anon" do Supabase é feita para o navegador (o acesso é controlado pelas regras do banco),
// e a chave VAPID pública só serve para o navegador assinar as notificações.
// NUNCA coloque aqui a chave "service_role" nem a VAPID privada.
window.APP_CONFIG = {
  SUPABASE_URL: "https://uashjywpybbeifbujsko.supabase.co",
  SUPABASE_ANON_KEY: "COLE_AQUI_A_CHAVE_ANON",    // Project Settings › API › anon public
  VAPID_PUBLIC_KEY: "BPqfc7Y9TOwr4qNRLo_AZKdmpUxSITCxNfrh9GLHxkGu0BjtE8cktzqY4SKl2vWb-Dnu14Z6OkShJ9qcbsDL5iY"
};
