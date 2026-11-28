import pkg from "../package.json";
import QRCode from "qrcode";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import jsQR from "jsqr";
import { loadOrCreateIdentity } from "./identity.js";
import { connect, RELAY } from "./relay.js";
import { initSignal, myBundle, myIk, startSession, encrypt, decrypt } from "./signal.js";
import { contacts, saveContact, chat, saveChat, addMsg, patchMsg, myName, setMyName, pref, setPref } from "./data.js";

const $ = (i) => document.getElementById(i);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (s) => { const t = $("toast"); t.textContent = s; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3000); };
let me, cur = null, q = Promise.resolve(), stream = null;
const run = (fn) => { const p = q.then(fn); q = p.catch(() => {}); return p; }; // ratchet অবস্থা একটা একটা করে বদলায়
const show = (v) => { for (const x of ["list", "chat", "add", "set"]) $(x).hidden = x !== v; if (v === "list") renderList(); };

let replyTo = null, showArch = false;
const GONE = "🚫 মেসেজ মুছে ফেলা হয়েছে";
const uid = () => crypto.randomUUID().slice(0, 8);
const chatExtra = [];
const sheet = (items) => {
  const s = $("sheet");
  s.innerHTML = items.map(([l], i) => `<button data-i="${i}" class="${[...l].length < 3 ? "em" : ""}">${esc(l)}</button>`).join("") + '<button data-i="x" class="cx">বাতিল</button>';
  s.hidden = false;
  s.onclick = (e) => { const i = e.target.dataset?.i; if (i === undefined) return; s.hidden = true; if (i !== "x") items[i][1](); };
};
const tx = (id, obj) => run(async () => {
  const e = await encrypt(id, JSON.stringify(obj));
  const r = await fetch(`${RELAY}/send/${id}`, { method: "POST", body: btoa(JSON.stringify({ f: me.id, ...e })) });
  if (r.status !== 202) throw new Error("রিলে " + r.status);
});

function renderList() {
  const f = $("sq").value.toLowerCase();
  const rows = Object.entries(contacts()).filter(([, v]) => v.state !== "blocked" && !!v.arch === showArch)
    .map(([id, v]) => ({ id, v, m: chat(id).at(-1) }))
    .filter(({ v, m }) => !f || v.name.toLowerCase().includes(f) || m?.x.toLowerCase().includes(f))
    .sort((a, b) => !!b.v.pin - !!a.v.pin || (b.m?.t || 0) - (a.m?.t || 0))
    .map(({ id, v, m }) => `<div class="row" data-id="${id}"><div class="av">${esc((v.name || "?")[0])}</div><div><b>${v.pin ? "📌 " : ""}${esc(v.name)}${v.mute ? " 🔇" : ""}${v.state === "pending" ? " (অনুরোধ)" : ""}</b><br><small>${esc(m ? m.x : "")}</small></div></div>`);
  $("rows").innerHTML = rows.join("") || `<p class="empty">${showArch ? "আর্কাইভ খালি" : "কোনো চ্যাট নেই। ➕ চেপে কন্টাক্ট যোগ করুন।"}</p>`;
  document.querySelectorAll(".row").forEach((r) => (r.onclick = () => openChat(r.dataset.id)));
}
function renderMsgs() {
  if (!cur) return;
  const f = $("csq").value.toLowerCase();
  $("msgs").innerHTML = chat(cur).filter((m) => !f || m.x.toLowerCase().includes(f)).map((m) => {
    const re = Object.values(m.re || {}).join("");
    return `<div class="b ${m.o ? "o" : "i"}" data-i="${m.i}">${m.r ? `<div class="q">${esc(m.r.x)}</div>` : ""}${esc(m.x)}${re ? `<span class="re">${esc(re)}</span>` : ""}</div>`;
  }).join("");
  $("msgs").scrollTop = 1e9;
}
function openChat(id) {
  cur = id; replyTo = null; $("rb").hidden = true; $("csq").value = ""; $("csq").hidden = true;
  const c = contacts()[id];
  $("cname").textContent = c.name; $("req").hidden = c.state !== "pending"; $("msgs").style.background = c.wp || "";
  renderMsgs(); show("chat");
}

async function send() {
  const x = $("inp").value.trim(), id = cur; if (!x || !id) return;
  const msg = { i: uid(), o: 1, x, t: Date.now(), ...(replyTo && { r: replyTo }) };
  $("inp").value = "";
  try {
    await tx(id, { k: "m", i: msg.i, x, n: myName(), ...(msg.r && { r: msg.r }) });
    addMsg(id, msg); replyTo = null; $("rb").hidden = true;
  } catch (e) { toast("পাঠানো যায়নি: " + e.message); $("inp").value = x; }
  renderMsgs();
}

function msgMenu(i) {
  const m = chat(cur).find((x) => x.i === i); if (!m || m.d) return; const id = cur;
  const react = (e) => { patchMsg(id, i, (x) => (x.re = { ...x.re, me: e })); tx(id, { k: "re", i, e }).catch((er) => toast(er.message)); renderMsgs(); };
  sheet([
    ["↩ রিপ্লাই", () => { replyTo = { i, x: m.x.slice(0, 80) }; $("rbt").textContent = "↩ " + replyTo.x; $("rb").hidden = false; $("inp").focus(); }],
    ...["👍", "❤️", "😂", "😮", "😢", "🙏"].map((e) => [e, () => react(e)]),
    ["🗑 আমার জন্য ডিলিট", () => { saveChat(id, chat(id).filter((x) => x.i !== i)); renderMsgs(); }],
    ...(m.o ? [["🗑 সবার জন্য ডিলিট", () => tx(id, { k: "del", i }).then(() => { patchMsg(id, i, (x) => Object.assign(x, { x: GONE, d: 1, re: {} })); renderMsgs(); }).catch((er) => toast(er.message))]] : []),
  ]);
}
function chatMenu() {
  const id = cur, c = contacts()[id], set = (p) => { saveContact(id, p); openChat(id); };
  sheet([
    [c.pin ? "📌 আনপিন" : "📌 পিন", () => set({ pin: !c.pin })],
    [c.arch ? "আনআর্কাইভ" : "🗄 আর্কাইভ", () => { saveContact(id, { arch: !c.arch }); show("list"); }],
    [c.mute ? "🔔 আনমিউট" : "🔇 মিউট", () => set({ mute: !c.mute })],
    ["🎨 ওয়ালপেপার", () => sheet([["ডিফল্ট", () => set({ wp: "" })], ["সবুজ", () => set({ wp: "#0d2b25" })], ["নীল", () => set({ wp: "#0f2233" })], ["বেগুনি", () => set({ wp: "#241a35" })]])],
    ...chatExtra.map((f) => f(id, c)),
  ]);
}

const applyTheme = () => (document.documentElement.dataset.theme = pref("theme", "dark"));
const settingsItems = [() => { const t = pref("theme", "dark"); return [`🌗 থিম: ${t === "dark" ? "ডার্ক" : "লাইট"} (বদলাতে চাপুন)`, () => { setPref("theme", t === "dark" ? "light" : "dark"); applyTheme(); renderSettings(); }]; }];
function renderSettings() {
  const b = $("sbody"); b.innerHTML = "";
  settingsItems.forEach((f) => { const [l, fn] = f(), x = document.createElement("button"); x.textContent = l; x.onclick = fn; b.append(x); });
}

const seen = new Set();
const onMsg = (m) => run(async () => {
  if (seen.has(m.id)) return; seen.add(m.id);
  try {
    const { f, t, b } = JSON.parse(atob(m.d)), c = contacts()[f];
    if (c?.state === "blocked") return;
    const p = JSON.parse(await decrypt(f, t, b)), k = p.k || "m";
    if (k === "m") {
      if (!c) saveContact(f, { name: p.n || "অজানা " + f.slice(0, 5), state: "pending" });
      addMsg(f, { i: p.i || uid(), o: 0, x: String(p.x), t: Date.now(), ...(p.r && { r: { i: p.r.i, x: String(p.r.x) } }) });
    } else if (k === "re") patchMsg(f, p.i, (x) => (x.re = { ...x.re, them: String(p.e).slice(0, 8) }));
    else if (k === "del") patchMsg(f, p.i, (x) => { if (!x.o) Object.assign(x, { x: GONE, d: 1, re: {} }); });
    cur === f ? renderMsgs() : $("list").hidden || renderList();
  } catch (e) { toast("ডিক্রিপ্ট ব্যর্থ: " + e.message); }
});

async function addFromText(txt) {
  let d; try { d = JSON.parse(txt); if (d.v !== 1 || !d.id || !d.ik) throw 0; } catch { return toast("QR বৈধ নয়"); }
  if (d.id === me.id) return toast("এটা আপনার নিজের QR");
  try {
    const r = await fetch(`${RELAY}/prekeys/${d.id}`); if (!r.ok) throw new Error("অপর জন এখনো অনলাইন হননি");
    const bundle = JSON.parse(await r.text());
    if (bundle.ik !== d.ik) throw new Error("চাবি মেলেনি, সম্ভাব্য ছদ্মবেশ!"); // QR-ই বিশ্বাসের উৎস
    await run(() => startSession(d.id, bundle));
    saveContact(d.id, { name: d.n || "অজানা " + d.id.slice(0, 5), state: "ok" });
    toast("যোগ হয়েছে"); openChat(d.id);
  } catch (e) { toast(e.message); }
}

const stopCam = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; $("vid").hidden = true; };
async function startCam() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const v = $("vid"); v.srcObject = stream; v.hidden = false; await v.play();
    const c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (!stream) return;
      if (v.videoWidth) {
        c.width = v.videoWidth; c.height = v.videoHeight; x.drawImage(v, 0, 0);
        const r = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        if (r) { stopCam(); return addFromText(r.data); }
      }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { stopCam(); toast("ক্যামেরা চালু হয়নি (" + (e.name || e.message) + "). ফোনের সেটিংসে BLINQ-এর ক্যামেরা অনুমতি দেখুন, বা 'ছবি তুলে স্ক্যান' চাপুন"); }
}
const decodeFile = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const bmp = await createImageBitmap(f), s = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = bmp.width * s; c.height = bmp.height * s;
  const x = c.getContext("2d"); x.drawImage(bmp, 0, 0, c.width, c.height);
  const r = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  r ? addFromText(r.data) : toast("QR পাওয়া যায়নি"); e.target.value = "";
};
$("pick").onchange = decodeFile; $("snap").onchange = decodeFile;

const qrText = () => JSON.stringify({ v: 1, id: me.id, ik: myIk(), n: myName() });
const drawQR = () => QRCode.toDataURL(qrText(), { width: 280, margin: 2 }).then((u) => ($("qr").src = u));
async function saveQR() {
  try {
    const url = await QRCode.toDataURL(qrText(), { width: 640, margin: 4 });
    if (Capacitor.isNativePlatform()) {
      const r = await Filesystem.writeFile({ path: "blinq-qr.png", data: url.split(",")[1], directory: Directory.Cache });
      await Share.share({ title: "আমার BLINQ QR", url: r.uri }); // শেয়ার শিট থেকে সেভ বা পাঠান
    } else { const a = document.createElement("a"); a.href = url; a.download = "blinq-qr.png"; a.click(); }
  } catch (e) { if (!/cancel/i.test(String(e.message))) toast("সেভ হয়নি: " + e.message); }
}
$("saveqr").onclick = saveQR;
$("addb").onclick = () => { show("add"); drawQR(); };
$("setb").onclick = () => { renderSettings(); show("set"); };
$("arc").onclick = () => { showArch = !showArch; $("arc").style.opacity = showArch ? 1 : 0.5; renderList(); };
$("sq").oninput = renderList;
$("csb").onclick = () => { $("csq").hidden = !$("csq").hidden; $("csq").value = ""; renderMsgs(); };
$("csq").oninput = renderMsgs;
$("menu").onclick = chatMenu;
$("msgs").onclick = (e) => { const b = e.target.closest(".b"); if (b) msgMenu(b.dataset.i); };
$("rbx").onclick = () => { replyTo = null; $("rb").hidden = true; };
$("myname").onchange = (e) => { setMyName(e.target.value.trim()); drawQR(); };
$("cam").onclick = startCam;
$("back").onclick = () => { cur = null; show("list"); };
$("back2").onclick = () => { stopCam(); show("list"); };
$("back3").onclick = () => show("list");
$("snd").onclick = send;
$("inp").onkeydown = (e) => e.key === "Enter" && send();
$("acc").onclick = () => { saveContact(cur, { state: "ok" }); $("req").hidden = true; };
$("blk").onclick = () => { saveContact(cur, { state: "blocked" }); cur = null; show("list"); };

(async () => {
  applyTheme();
  me = await loadOrCreateIdentity(); await initSignal();
  $("ver").textContent = "v" + pkg.version; $("myname").value = myName();
  connect(me, onMsg, (s) => ($("st").textContent = s), (ws) => ws.send(JSON.stringify({ t: "prekeys", b: JSON.stringify(myBundle()) })));
  show("list");
})();
