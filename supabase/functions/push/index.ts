// Função "push" do Supabase: envia as notificações do China 2026.
//  { action: "test" } (chamada pelo app, com o login do viajante): manda um teste para os aparelhos dele.
//  { action: "tick" } (chamada pelo agendador a cada minuto): avisos de alterações, lembretes, resumo das 7h e trens.
// Segredos (Edge Functions › Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:seu@email), APP_URL.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:viagem@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
const APP_URL = Deno.env.get("APP_URL") ?? "https://nelinhorios-create.github.io/china-2026/";
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"};

type Prefs = {remind: number; morning: boolean; trains: boolean; changes: boolean; quiet: boolean; quietFrom: string; quietTo: string};
const DEF: Prefs = {remind: 30, morning: true, trains: true, changes: true, quiet: true, quietFrom: "23:00", quietTo: "07:00"};
const hm = (t: string) => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : -1; };
const chinaNow = () => { const d = new Date(Date.now() + 8 * 3600e3); return {iso: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dm: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`}; };
const quietNow = (p: Prefs, min: number) => { if (!p.quiet) return false; const a = hm(p.quietFrom), b = hm(p.quietTo); return a <= b ? min >= a && min < b : min >= a || min < b; };
const fmtD = (iso: string) => `${+iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), {status, headers: {...CORS, "Content-Type": "application/json"}});

async function sendTo(userIds: string[], payload: Record<string, unknown>) {
  if (!userIds.length) return 0;
  const {data} = await sb.from("push_subs").select("endpoint, sub, user_id").in("user_id", userIds);
  let n = 0;
  for (const s of data ?? []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), {TTL: 3600}); n++; }
    catch (e) { const code = (e as {statusCode?: number}).statusCode; if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }
  return n;
}
// registra a chave; se já existia, o aviso já foi enviado antes
const once = async (key: string) => !(await sb.from("notif_log").insert({key})).error;

// itens do dia = horários do roteiro base + ajustes + itens novos (sem os ocultos)
function dayItems(day: any, edits: Record<string, any>) {
  const out: {key: string; t: string; title: string}[] = [];
  (day.h || []).forEach(([t, x]: [string, string], i: number) => {
    const key = `${day.id}~h${i}`, e = edits[key] || {};
    if (e.hidden) return;
    out.push({key, t: e.t || t, title: (e.title || x).replace(/^🛍\s*/, "")});
  });
  Object.entries(edits).forEach(([key, e]) => { if (e.kind === "new" && e.day === day.id && !e.hidden && e.t) out.push({key, t: e.t, title: e.title}); });
  return out.filter(x => hm(x.t) >= 0).sort((a, b) => hm(a.t) - hm(b.t));
}

async function tick() {
  const now = chinaNow();
  const [{data: profs}, {data: subs}, {data: tripRow}, {data: editRows}] = await Promise.all([
    sb.from("profiles").select("id, name, settings"),
    sb.from("push_subs").select("user_id"),
    sb.from("trip").select("data").eq("id", "main").maybeSingle(),
    sb.from("edits").select("id, body"),
  ]);
  const P: Record<string, {name: string; p: Prefs}> = {};
  (profs ?? []).forEach((r: any) => P[r.id] = {name: r.name || "Alguém", p: {...DEF, ...(r.settings || {})}});
  const users = [...new Set((subs ?? []).map((s: any) => s.user_id))].filter(u => P[u]);
  const days: any[] = tripRow?.data?.days ?? [];
  const edits: Record<string, any> = {}; (editRows ?? []).forEach((r: any) => edits[r.id] = r.body);
  let sent = 0;

  // 1) alterações feitas pelo grupo
  const {data: queue} = await sb.from("notify_queue").select("*").order("id").limit(50);
  for (const q of queue ?? []) {
    await sb.from("notify_queue").delete().eq("id", q.id);
    if (Date.now() - new Date(q.created_at).getTime() > 30 * 60e3) continue; // velho demais
    const b = q.body || {}, o = q.old || {};
    const dayId = b.day || o.day || String(q.edit_id).split("~")[0];
    const day = days.find(d => d.id === dayId);
    const base = !String(q.edit_id).startsWith("n-");
    const baseRow = base && day ? (day.h || [])[+String(q.edit_id).split("~h")[1]] : null;
    const title = b.title || o.title || (baseRow ? baseRow[1] : "item");
    let verb = "";
    if (q.op === "DELETE") verb = base ? "voltou ao original" : "excluiu";
    else if (q.op === "INSERT") verb = b.kind === "new" ? "adicionou" : b.hidden ? "ocultou" : (b.t || b.title || b.note) ? "ajustou" : "";
    else if (!!b.hidden !== !!o.hidden) verb = b.hidden ? "ocultou" : "trouxe de volta";
    else if (b.t !== o.t || b.title !== o.title || b.note !== o.note || b.day !== o.day) verb = "ajustou";
    if (!verb) continue; // só marcou como feito: não avisa
    const who = P[q.author]?.name?.split(" ")[0] || "Alguém";
    const to = users.filter(u => u !== q.author && P[u].p.changes && !quietNow(P[u].p, now.min));
    sent += await sendTo(to, {
      title: `${who} ${verb}: ${b.t ? b.t + " · " : ""}${title}`.slice(0, 120),
      body: day ? `${fmtD(day.date)} · ${day.title}` : "Roteiro atualizado",
      tag: `edit-${q.edit_id}`, url: `${APP_URL}?day=${encodeURIComponent(dayId)}`,
    });
  }

  // 2) lembretes do dia (horário da China)
  const today = days.find(d => d.date === now.iso), idx = days.indexOf(today);
  for (const u of users) {
    const p = P[u].p;
    if (quietNow(p, now.min)) continue;
    if (today) {
      if (p.morning && now.min >= 420 && now.min < 430 && await once(`m:${u}:${now.iso}`)) {
        const its = dayItems(today, edits).filter(x => hm(x.t) >= 420).slice(0, 4).map(x => `${x.t} ${x.title}`).join(" · ");
        sent += await sendTo([u], {title: `Bom dia! Dia ${idx + 1}: ${today.title}`, body: its || today.cn, tag: `m-${now.iso}`, url: `${APP_URL}?day=${today.id}`});
      }
      if (p.remind > 0) for (const it of dayItems(today, edits)) {
        const at = hm(it.t) - p.remind;
        if (now.min >= at && now.min < at + 5 && await once(`r:${u}:${it.key}:${now.iso}:${it.t}`))
          sent += await sendTo([u], {title: `${it.t} · ${it.title}`.slice(0, 120), body: `Em ${p.remind} min · ${today.cn}`, tag: `r-${it.key}`, url: `${APP_URL}?day=${today.id}`});
      }
      if (p.trains) for (const tr of today.trains || []) {
        const at = hm(tr.d) - 120;
        if (now.min >= at && now.min < at + 5 && await once(`t:${u}:${tr.n}:${now.iso}`))
          sent += await sendTo([u], {title: `Trem ${tr.n} às ${tr.d}`, body: `${tr.from} → ${tr.to}. Saiam com folga e passaporte na mão.`, tag: `t-${tr.n}`, url: `${APP_URL}?day=${today.id}`});
      }
    }
    // venda de trem que abre hoje (para os que ainda não foram comprados)
    if (p.trains && now.min >= 540 && now.min < 545) for (const d of days) for (const tr of d.trains || []) {
      if (!tr.bought && String(tr.sale).startsWith(now.dm) && await once(`s:${u}:${tr.n}:${now.iso}`))
        sent += await sendTo([u], {title: `Venda do trem ${tr.n} abre hoje`, body: `${fmtD(d.date)} · ${tr.from} → ${tr.to} às ${tr.d}. Comprem no Trip.com ou no 12306.`, tag: `s-${tr.n}`, url: `${APP_URL}?day=${d.id}`});
    }
  }
  return {sent, users: users.length, queue: queue?.length ?? 0};
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: CORS});
  let body: any = {};
  try { body = await req.json(); } catch { /* sem corpo */ }
  try {
    if (body.action === "test") {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const {data: {user}} = await sb.auth.getUser(jwt);
      if (!user) return json({error: "login necessário"}, 401);
      const n = await sendTo([user.id], {title: "China 2026 · teste", body: "As notificações estão funcionando neste aparelho. 一路顺风!", tag: "test", url: APP_URL});
      return json({sent: n});
    }
    if (body.action === "tick") return json(await tick());
    return json({error: "ação desconhecida"}, 400);
  } catch (e) {
    return json({error: String((e as Error).message || e)}, 500);
  }
});
