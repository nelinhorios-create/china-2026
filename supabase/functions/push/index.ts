// Função "push" do Supabase: envia as notificações do China 2026.
//  { action: "test" } (chamada pelo app, com o login do viajante): manda um teste para os aparelhos dele.
//  { action: "tick" } (chamada pelo agendador a cada minuto): avisos de alterações, lembretes, resumo das 7h e trens.
// Único segredo (Edge Functions › Secrets): VAPID_PRIVATE_KEY. A chave pública e o endereço do site já são públicos.
// Publicar com "Verify JWT" desligado: o agendador chama sem chave; o teste confere o login do viajante aqui dentro.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VAPID_PUBLIC = "BPqfc7Y9TOwr4qNRLo_AZKdmpUxSITCxNfrh9GLHxkGu0BjtE8cktzqY4SKl2vWb-Dnu14Z6OkShJ9qcbsDL5iY";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:china2026@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY") ?? VAPID_PUBLIC, Deno.env.get("VAPID_PRIVATE_KEY")!);
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

  // 1) o que o grupo fez desde o último minuto
  //    roteiro: até 2 mudanças da mesma pessoa viram avisos separados; mais que isso, um resumo
  //    fotos: um aviso por pessoa e álbum ("Ana adicionou 5 fotos em Muralha"); álbum novo; recado (NOTE, inserido por SQL)
  const {data: queue} = await sb.from("notify_queue").select("*").order("id").limit(200);
  const {data: albumRows} = await sb.from("albums").select("id, name");
  const albumName = (id: string) => (albumRows ?? []).find((a: any) => a.id === id)?.name || "";
  const first = (id: string) => P[id]?.name?.split(" ")[0] || "Alguém";
  const changesFor = (author: string | null) => users.filter(u => u !== author && P[u].p.changes && !quietNow(P[u].p, now.min));
  const editBy: Record<string, {msgs: {title: string; body: string; tag: string; url: string}[]; days: Set<string>}> = {};
  const photoBy: Record<string, {author: string; n: number; day: string; album: string; moved: boolean}> = {};
  for (const q of queue ?? []) {
    await sb.from("notify_queue").delete().eq("id", q.id);
    if (Date.now() - new Date(q.created_at).getTime() > 30 * 60e3) continue; // velho demais
    const b = q.body || {}, o = q.old || {};
    if (q.op === "NOTE") { // recado para todos (teste ou aviso geral)
      sent += await sendTo(users, {title: b.title || "China 2026", body: b.body || "", tag: `note-${q.id}`, url: APP_URL});
      continue;
    }
    if (q.op === "ALBUM") {
      sent += await sendTo(changesFor(q.author), {title: `${first(q.author)} criou o álbum “${b.name}”`, body: "Toquem para ver e colocar fotos", tag: `album-${b.album}`, url: `${APP_URL}?tab=fotos&album=${b.album}`});
      continue;
    }
    if (q.op === "PHOTO" || q.op === "PHOTO_MOVE") {
      const key = `${q.author}|${b.album || ""}|${q.op}`;
      const r = photoBy[key] ||= {author: q.author, n: 0, day: b.day || "", album: b.album || "", moved: q.op === "PHOTO_MOVE"}; r.n++;
      continue;
    }
    const dayId = b.day || o.day || String(q.edit_id).split("~")[0];
    const day = days.find(d => d.id === dayId);
    const base = !String(q.edit_id).startsWith("n-");
    const baseRow = base && day ? (day.h || [])[+String(q.edit_id).split("~h")[1]] : null;
    const title = (b.title || o.title || (baseRow ? baseRow[1] : "item")).replace(/^🛍\s*/, "");
    let verb = "";
    if (q.op === "DELETE") verb = base ? "voltou ao original" : "excluiu";
    else if (q.op === "INSERT") verb = b.kind === "new" ? "adicionou" : b.hidden ? "ocultou" : (b.t || b.title || b.note) ? "ajustou" : "";
    else if (!!b.hidden !== !!o.hidden) verb = b.hidden ? "ocultou" : "trouxe de volta";
    else if (b.day !== o.day) verb = "mudou de dia";
    else if (b.t !== o.t || b.title !== o.title || b.note !== o.note) verb = "ajustou";
    if (!verb) continue; // só marcou como feito: não avisa
    const e = editBy[q.author ?? ""] ||= {msgs: [], days: new Set()};
    if (day) e.days.add(fmtD(day.date));
    e.msgs.push({title: `${first(q.author)} ${verb}: ${b.t ? b.t + " · " : ""}${title}`.slice(0, 120),
      body: day ? `${fmtD(day.date)} · ${day.title}` : "Roteiro atualizado", tag: `edit-${q.edit_id}`, url: `${APP_URL}?day=${encodeURIComponent(dayId)}`});
  }
  for (const [author, e] of Object.entries(editBy)) {
    const to = changesFor(author || null);
    if (e.msgs.length <= 2) { for (const m of e.msgs) sent += await sendTo(to, m); }
    else sent += await sendTo(to, {title: `${first(author)} fez ${e.msgs.length} mudanças no roteiro`, body: e.days.size ? `Dias: ${[...e.days].join(", ")}` : "Abram o app para ver", tag: `edits-${author}`, url: APP_URL});
  }
  for (const r of Object.values(photoBy)) {
    const day = days.find(d => d.id === r.day), alb = albumName(r.album);
    const what = `${r.n} foto${r.n > 1 ? "s" : ""}`;
    sent += await sendTo(changesFor(r.author), {
      title: r.moved ? `${first(r.author)} colocou ${what} em “${alb}”` : `${first(r.author)} adicionou ${what}${alb ? ` em “${alb}”` : ""}`,
      body: day ? `${fmtD(day.date)} · ${day.title}` : alb ? "Álbum da viagem" : "Fotos da viagem",
      tag: `photos-${r.author}-${r.album}`, url: `${APP_URL}?tab=fotos${r.album ? `&album=${r.album}` : ""}`});
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
