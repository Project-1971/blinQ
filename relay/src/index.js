import { DurableObject } from "cloudflare:workers";

const MAX_MSG = 64 * 1024;          // এক মেসেজের সর্বোচ্চ আকার
const MAX_QUEUE = 1000;             // অফলাইন কিউয়ে সর্বোচ্চ মেসেজ
const TTL_MS = 30 * 24 * 3600e3;    // ৩০ দিন পর মুছে যায়
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ID = Ed25519 পাবলিক কী (৩২ বাইট, base64url)। সই যাচাই করে মালিক প্রমাণ।
async function verify(id, sigB64, msg) {
  try {
    const pub = unb64u(id), sig = unb64u(sigB64);
    for (const a of [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }]) {
      try {
        const k = await crypto.subtle.importKey("raw", pub, a, false, ["verify"]);
        return await crypto.subtle.verify(a.name, k, sig, msg);
      } catch {}
    }
  } catch {}
  return false;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const m = new URL(req.url).pathname.match(/^\/(ws|send|prekeys)\/([A-Za-z0-9_-]{43})$/);
    if (!m) return new Response("not found", { status: 404, headers: CORS });
    const h = new Headers(req.headers);
    h.set("x-route", m[1]);
    h.set("x-mailbox", m[2]);
    const res = await env.MAILBOX.get(env.MAILBOX.idFromName(m[2])).fetch(new Request(req, { headers: h }));
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};

export class Mailbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, d TEXT NOT NULL)");
  }

  async fetch(req) {
    const route = req.headers.get("x-route"), id = req.headers.get("x-mailbox");
    const sql = this.ctx.storage.sql;

    if (route === "ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("websocket required", { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server); // Hibernation API: নিষ্ক্রিয় থাকলে কম্পিউট সময় খরচ হয় না
      const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
      server.serializeAttachment({ id, challenge, authed: false });
      server.send(JSON.stringify({ t: "challenge", c: challenge }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (route === "send" && req.method === "POST") {
      const d = await req.text();
      if (!d || d.length > MAX_MSG) return new Response("bad size", { status: 413 });
      sql.exec("DELETE FROM msgs WHERE ts < ?", Date.now() - TTL_MS);
      if (sql.exec("SELECT COUNT(*) AS n FROM msgs").one().n >= MAX_QUEUE) return new Response("mailbox full", { status: 429 });
      const mid = sql.exec("INSERT INTO msgs (ts, d) VALUES (?, ?) RETURNING id", Date.now(), d).one().id;
      for (const ws of this.ctx.getWebSockets()) {
        if (ws.deserializeAttachment()?.authed) ws.send(JSON.stringify({ t: "msg", id: mid, d }));
      }
      return new Response(null, { status: 202 });
    }

    if (route === "prekeys" && req.method === "GET") {
      const p = await this.ctx.storage.get("prekeys");
      return p ? new Response(p, { headers: { "content-type": "text/plain" } }) : new Response("none", { status: 404 });
    }
    return new Response("method not allowed", { status: 405 });
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return ws.close(1003, "bad json"); }
    const a = ws.deserializeAttachment();
    const sql = this.ctx.storage.sql;

    if (m.t === "auth" && !a.authed) {
      const ok = await verify(a.id, String(m.sig), new TextEncoder().encode("mess-auth-v1:" + a.challenge));
      if (!ok) return ws.close(4401, "auth failed");
      ws.serializeAttachment({ ...a, authed: true });
      ws.send(JSON.stringify({ t: "ready" }));
      for (const r of sql.exec("SELECT id, d FROM msgs ORDER BY id").toArray()) ws.send(JSON.stringify({ t: "msg", id: r.id, d: r.d }));
      return;
    }
    if (!a.authed) return ws.close(4401, "auth first");

    if (m.t === "ack" && Array.isArray(m.ids)) {
      for (const i of m.ids.slice(0, 100)) sql.exec("DELETE FROM msgs WHERE id = ?", Number(i)); // ডেলিভারির পর মুছে ফেলা
    } else if (m.t === "prekeys" && typeof m.b === "string" && m.b.length <= 16384) {
      await this.ctx.storage.put("prekeys", m.b);
    }
  }

  webSocketClose(ws) { try { ws.close(1000); } catch {} }
}
