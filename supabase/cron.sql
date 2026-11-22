-- China 2026 · agendador das notificações (roda a função "push" a cada minuto)
-- Antes de rodar: troque PROJECT_REF pelo código do projeto (o pedaço antes de .supabase.co)
-- e ANON_KEY pela chave anon public (a mesma do config.js).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('china26-push') where exists (select 1 from cron.job where jobname = 'china26-push');
select cron.schedule('china26-push', '* * * * *', $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ANON_KEY'),
    body := '{"action":"tick"}'::jsonb
  );
$$);

-- limpeza semanal do registro de avisos enviados
select cron.unschedule('china26-log-cleanup') where exists (select 1 from cron.job where jobname = 'china26-log-cleanup');
select cron.schedule('china26-log-cleanup', '0 3 * * 0', $$ delete from public.notif_log where sent_at < now() - interval '7 days'; $$);
