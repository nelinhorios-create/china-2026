# China 2026 · Guia de Bolso

App para celular com o roteiro da viagem (9 a 30/12/2026): programação de cada dia, hotéis, trens,
trajetos, frases em chinês com áudio, edições compartilhadas entre os viajantes e notificações.

- **Site:** https://nelinhorios-create.github.io/china-2026/
- **Hospedagem:** GitHub Pages (grátis). **Banco, login e notificações:** Supabase, plano Free.
- O repositório é público. Por isso **o roteiro não está aqui**: ele fica no Supabase e só aparece depois do login.

## Passo a passo (uma vez só)

### 1. Supabase: criar o projeto
1. Em https://supabase.com, crie a conta e um projeto (região **Singapore** ou **Tokyo**).
2. **Authentication › Sign In / Providers › Email:** deixe *Email* ligado e **desligue “Confirm email”**.
   O login do app é só **usuário e senha**: o app transforma o usuário num e-mail interno
   (`usuario@china2026.example.com`) que nunca recebe mensagem. Para criar conta é preciso o **código da viagem**.

### 2. Banco
No **SQL Editor**, rode nesta ordem:
1. `supabase/schema.sql` (tabelas, regras de acesso e tempo real).
2. O arquivo **carga-roteiro.sql**, que o Claude entregou fora do GitHub (roteiro + código da viagem).

### 3. Ligar o site ao Supabase
Em **Project Settings › API**, copie a *Project URL* e a chave *anon public* para o `config.js` deste repositório
(editar no próprio GitHub e fazer *Commit*). A chave `service_role` **nunca** vai para o repositório.

### 4. Notificações
1. **Edge Functions › Deploy a new function › Via Editor**, nome **`push`**. Cole o conteúdo de
   `supabase/functions/push/index.ts` e publique.
2. **Edge Functions › Secrets**, crie:
   - `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`: do arquivo **vapid.txt** que o Claude entregou fora do GitHub
     (a pública é a mesma que está no `config.js`);
   - `VAPID_SUBJECT`: `mailto:` + o e-mail de vocês (ex.: `mailto:fulano@gmail.com`);
   - `APP_URL`: `https://nelinhorios-create.github.io/china-2026/`
3. No **SQL Editor**, abra `supabase/cron.sql`, troque `PROJECT_REF` e `ANON_KEY` e rode. A partir daí a função roda
   a cada minuto.

### 5. No celular de cada viajante
1. Abram o site e criem a conta: usuário, senha (6+ caracteres), nome e o código da viagem.
   Esqueceu a senha? No Supabase, *Authentication › Users*, apaguem o usuário e criem a conta de novo.
2. **iPhone (iOS 16.4 ou mais novo):** no Safari, *Compartilhar › Adicionar à Tela de Início* e abram pelo ícone.
   **Android:** no Chrome, *Instalar app* (ou o botão “Instalar o app” na aba Conta).
3. Aba **Conta › Notificações › Ativar neste aparelho** e depois **Enviar teste**.

## O que avisa
- **Ajustes e novas programações:** quando alguém adiciona, muda, oculta ou exclui um item (marcar como feito não avisa).
- **Lembrete** 15, 30 ou 60 min antes de cada item do dia.
- **Resumo do dia** às 7h e **trens** 2h antes da partida; para trens ainda não comprados, aviso às 9h do dia em que a venda abre.
- Tudo no horário da China, com silêncio das 23h às 7h (dá para desligar). Cada um escolhe na aba Conta.

## Bom saber
- O plano Free do Supabase **pausa o projeto depois de 7 dias sem uso**. Se acontecer antes da viagem, entrem no painel
  e cliquem em *Restore*; nada se perde.
- Na China, com o eSIM de roaming, tudo funciona. Em Wi-Fi de hotel o Supabase pode estar bloqueado: o guia abre pela
  cópia salva no celular e envia as mudanças quando voltarem ao eSIM.

## Arquivos
- `index.html` app inteiro · `config.js` endereços públicos · `sw.js` modo offline e notificações · `manifest.webmanifest` e `icon-*.png` instalação · `img/` fotos (Wikimedia Commons, licenças CC BY / CC BY-SA)
- `supabase/schema.sql` banco · `supabase/functions/push/index.ts` envio de notificações · `supabase/cron.sql` agendador
