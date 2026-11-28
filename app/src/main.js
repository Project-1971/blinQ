import pkg from "../package.json";
import QRCode from "qrcode";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import jsQR from "jsqr";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";
import { loadOrCreateIdentity } from "./identity.js";
import { connect, RELAY } from "./relay.js";
import { initSignal, myBundle, myIk, startSession, encrypt, decrypt, safety, resetPeer } from "./signal.js";
import { contacts, saveContact, chat, saveChat, addMsg, patchMsg, myName, setMyName, pref, setPref } from "./data.js";

const $ = (i) => document.getElementById(i);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (s) => { const t = $("toast"); t.textContent = tr(s); t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3000); };
let me, cur = null, q = Promise.resolve(), stream = null;
const run = (fn) => { const p = q.then(fn); q = p.catch(() => {}); return p; }; // ratchet অবস্থা একটা একটা করে বদলায়
const MAIN = ["list", "grp", "bro", "you"];
const show = (v) => {
  for (const x of [...MAIN, "chat", "add", "pg"]) $(x).hidden = x !== v;
  $("tabs").hidden = !MAIN.includes(v);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === v));
  if (v === "list") renderList(); if (v === "you") renderYou();
};

let replyTo = null, showArch = false;
const GONE = "🚫 মেসেজ মুছে ফেলা হয়েছে";
const uid = () => crypto.randomUUID().slice(0, 8);
const chatExtra = [];
const sheet = (items) => {
  const s = $("sheet");
  s.innerHTML = items.map(([l], i) => `<button data-i="${i}" class="${[...l].length < 3 ? "em" : ""}">${esc(tr(l))}</button>`).join("") + '<button data-i="x" class="cx">বাতিল</button>';
  s.hidden = false;
  s.onclick = (e) => { const i = e.target.dataset?.i; if (i === undefined) return; s.hidden = true; if (i !== "x") items[i][1](); };
};
const tx = (id, obj) => run(async () => {
  const e = await encrypt(id, JSON.stringify(obj));
  const r = await fetch(`${RELAY}/send/${id}`, { method: "POST", body: btoa(JSON.stringify({ f: me.id, ...e })) });
  if (r.status !== 202) throw new Error("রিলে " + r.status);
});

function renderMsgs() {
  if (!cur) return;
  const f = $("csq").value.toLowerCase();
  $("msgs").innerHTML = chat(cur).filter((m) => !f || m.x.toLowerCase().includes(f)).map((m) => {
    const re = Object.values(m.re || {}).join("");
    return `<div class="b ${m.s ? "s" : m.o ? "o" : "i"}" data-i="${m.i}">${m.r ? `<div class="q">${esc(m.r.x)}</div>` : ""}${esc(m.d || m.s ? tr(m.x) : m.x)}${re ? `<span class="re">${esc(re)}</span>` : ""}</div>`;
  }).join("");
  $("msgs").scrollTop = 1e9;
}
function openChat(id) {
  cur = id; replyTo = null; $("rb").hidden = true; $("csq").value = ""; $("csq").hidden = true;
  const c = contacts()[id];
  $("cname").textContent = c.name; $("cabout").textContent = c.about || ""; $("req").hidden = c.state !== "pending"; $("warn").hidden = !c.warn; $("msgs").style.background = c.wp || "";
  renderMsgs(); show("chat");
}

async function send() {
  const x = $("inp").value.trim(), id = cur; if (!x || !id) return;
  const msg = { i: uid(), o: 1, x, t: Date.now(), ...(replyTo && { r: replyTo }), ...(contacts()[id]?.dis && { exp: Date.now() + contacts()[id].dis * 1000 }) };
  $("inp").value = "";
  try {
    await tx(id, { k: "m", i: msg.i, x, n: pref("v.n", "contacts") !== "none" ? myName() : "", ...(msg.r && { r: msg.r }) });
    addMsg(id, msg); replyTo = null; $("rb").hidden = true;
  } catch (e) { toast("পাঠানো যায়নি: " + e.message); $("inp").value = x; }
  renderMsgs();
}

function msgMenu(i) {
  const m = chat(cur).find((x) => x.i === i); if (!m || m.d || m.s) return; const id = cur;
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
  let fr;
  try {
    const { f, t, b } = JSON.parse(atob(m.d)), c = contacts()[(fr = f)];
    if (c?.state === "blocked") return;
    const p = JSON.parse(await decrypt(f, t, b)), k = p.k || "m";
    if (k === "m") {
      if (!c) saveContact(f, { name: p.n || "BLINQ " + f.slice(0, 5), state: "pending" });
      addMsg(f, { i: p.i || uid(), o: 0, x: String(p.x), t: Date.now(), ...(c?.dis && { exp: Date.now() + c.dis * 1000 }), ...(p.r && { r: { i: p.r.i, x: String(p.r.x) } }) });
    } else if (k === "re") patchMsg(f, p.i, (x) => (x.re = { ...x.re, them: String(p.e).slice(0, 8) }));
    else if (k === "del") patchMsg(f, p.i, (x) => { if (!x.o) Object.assign(x, { x: GONE, d: 1, re: {} }); });
    else if (k === "dis" && c && [0, 3600, 86400, 604800].includes(p.s)) setDis(f, p.s, false);
    else if (k === "pf") gotProfile(f, p);
    cur === f ? renderMsgs() : $("list").hidden || renderList();
  } catch (e) {
    if (fr && contacts()[fr] && /identity|trust/i.test(e.message)) { saveContact(fr, { warn: true }); if (cur === fr) openChat(fr); toast("⚠️ নিরাপত্তা কোড বদলেছে"); }
    else toast("ডিক্রিপ্ট ব্যর্থ: " + e.message);
  }
});

async function addFromText(txt) {
  let d; try { d = JSON.parse(txt); if (d.v !== 1 || !d.id || !d.ik) throw 0; } catch { return toast("QR বৈধ নয়"); }
  if (d.id === me.id) return toast("এটা আপনার নিজের QR");
  try {
    const r = await fetch(`${RELAY}/prekeys/${d.id}`); if (!r.ok) throw new Error("অপর জন এখনো অনলাইন হননি");
    const bundle = JSON.parse(await r.text());
    if (bundle.ik !== d.ik) throw new Error("চাবি মেলেনি, সম্ভাব্য ছদ্মবেশ!"); // QR-ই বিশ্বাসের উৎস
    await run(() => startSession(d.id, bundle));
    saveContact(d.id, { name: d.n || "BLINQ " + d.id.slice(0, 5), state: "ok" });
    toast("যোগ হয়েছে"); openChat(d.id); sendProfile(d.id);
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

const qrText = () => JSON.stringify({ v: 1, id: me.id, ik: myIk(), n: pref("v.n", "contacts") === "all" ? myName() : "" });
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
// ---- v0.6.0: নতুন চেহারা (ট্যাব, You, ভাষা) ----
const PAIRS = [
  ["পুরনো চাবি মুছে ফেলা হয়েছে। অপর জনের QR আবার স্ক্যান করে নিরাপত্তা কোড মিলিয়ে নিন।", "Old key removed. Scan their QR again and compare the safety code."],
  ["কোনো চ্যাট নেই। ➕ চেপে কন্টাক্ট যোগ করুন।", "No chats yet. Tap + to add a contact."], ["আর্কাইভ খালি", "Archive is empty"], ["(অনুরোধ)", "(request)"],
  ["QR বৈধ নয়", "Invalid QR"], ["এটা আপনার নিজের QR", "This is your own QR"], ["অপর জন এখনো অনলাইন হননি", "The other person hasn't been online yet"],
  ["চাবি মেলেনি, সম্ভাব্য ছদ্মবেশ!", "Key mismatch, possible impersonation!"], ["যোগ হয়েছে", "Contact added"], ["ক্যামেরা চালু হয়নি (", "Camera failed to start ("],
  ["). ফোনের সেটিংসে BLINQ-এর ক্যামেরা অনুমতি দেখুন, বা 'ছবি তুলে স্ক্যান' চাপুন", "). Check BLINQ's camera permission in settings, or tap 'Take photo to scan'"],
  ["QR পাওয়া যায়নি", "No QR found"], ["সেভ হয়নি: ", "Couldn't save: "], ["আমার BLINQ QR", "My BLINQ QR"], ["পাঠানো যায়নি: ", "Couldn't send: "],
  ["ডিক্রিপ্ট ব্যর্থ: ", "Decryption failed: "], ["রিলে ", "Relay "], ["🚫 মেসেজ মুছে ফেলা হয়েছে", "🚫 This message was deleted"],
  ["ডিজঅ্যাপিয়ারিং", "Disappearing messages"], ["নিরাপত্তা কোড বদলেছে", "Safety code changed"], ["নিরাপত্তা কোড", "Safety code"],
  ["১ ঘণ্টা", "1 hour"], ["১ দিন", "1 day"], ["৭ দিন", "7 days"], ["বন্ধ", "Off"],
  ["📌 আনপিন", "📌 Unpin"], ["📌 পিন", "📌 Pin"], ["আনআর্কাইভ", "Unarchive"], ["🗄 আর্কাইভ", "🗄 Archive"], ["🔔 আনমিউট", "🔔 Unmute"], ["🔇 মিউট", "🔇 Mute"],
  ["🎨 ওয়ালপেপার", "🎨 Wallpaper"], ["ডিফল্ট", "Default"], ["সবুজ", "Green"], ["নীল", "Blue"], ["বেগুনি", "Purple"], ["বাতিল", "Cancel"],
  ["↩ রিপ্লাই", "↩ Reply"], ["🗑 আমার জন্য ডিলিট", "🗑 Delete for me"], ["🗑 সবার জন্য ডিলিট", "🗑 Delete for everyone"],
  ["আপনার ও ", "You and "], ["-এর কোড (দুজনের ফোনে হুবহু এক হতে হবে):", "'s code (must be identical on both phones):"],
  ["সামনাসামনি বা ফোনে মিলিয়ে নিন।", "Compare in person or by phone."], ["কোড এখনো তৈরি হয়নি, আগে একটা মেসেজ আদান-প্রদান করুন।", "Code not ready yet, exchange a message first."],
  ["সব চ্যাট, কন্টাক্ট ও চাবি মুছে যাবে। নিশ্চিত?", "All chats, contacts and keys will be erased. Sure?"],
  ["ভুল PIN (আর ", "Wrong PIN ("], [" বার)", " tries left)"], ["BLINQ খুলুন", "Unlock BLINQ"],
  ["সংযোগ হচ্ছে…", "Connecting…"], ["বিচ্ছিন্ন…", "Disconnected…"], ["সংযুক্ত ✅", "Connected ✅"],
];
const lang = () => pref("lang", "bn");
const tr = (s) => (lang() === "en" ? PAIRS.reduce((a, [b, e]) => a.split(b).join(e), String(s)) : s);
const t = (bn, en) => (lang() === "en" ? en : bn);
for (const k of ["alert", "confirm", "prompt"]) { const f = window[k]; window[k] = (s, ...r) => f.call(window, tr(s), ...r); }

const IC = {
  chats: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  groups: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4.5 2 4.5 5"/>',
  bcast: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a5.9 5.9 0 0 0 0 8.4M16.2 7.8a5.9 5.9 0 0 1 0 8.4M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4"/>',
  you: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  storage: '<path d="M8 20V5M8 5L4.5 8.5M8 5l3.5 3.5M16 4v15M16 19l-3.5-3.5M16 19l3.5-3.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01"/>',
  heart: '<path d="M12 20s-8-5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20z"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
};
const ic = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const avatar = (v, name, big) => v?.photo ? `<img class="av${big ? " big" : ""}" src="${esc(v.photo)}">` : `<div class="av${big ? " big" : ""}">${esc((name || "?")[0] || "?")}</div>`;
const fmt = (ts) => { const d = new Date(ts); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" }); };

const TABS = [["list", "chats", "চ্যাট", "Chats"], ["grp", "groups", "গ্রুপ", "Groups"], ["bro", "bcast", "ব্রডকাস্ট", "Broadcasts"], ["you", "you", "আপনি", "You"]];
function soon(id, icon, [b, e]) {
  $(id).innerHTML = `<div class="top"></div><h1>${esc(t(b, e))}</h1><div class="soon">${ic(icon, 56)}<h2>${esc(t("শীঘ্রই আসছে", "Coming soon"))}</h2><p>${esc(t("এই সুবিধা পরের আপডেটে আসছে।", "This feature is coming in a future update."))}</p></div>`;
}
function buildTabs() {
  $("tabs").innerHTML = TABS.map(([id, i, b, e]) => `<button data-t="${id}">${ic(i, 24)}<span>${esc(t(b, e))}</span></button>`).join("");
  $("tabs").onclick = (e) => { const id = e.target.closest("button")?.dataset.t; if (id) { if (id === "list") showArch = false; show(id); } };
  $("dotsb").innerHTML = ic("dots"); $("scanb").innerHTML = ic("scan"); $("addb").innerHTML = ic("plus");
  $("csb").innerHTML = ic("search"); $("menu").innerHTML = ic("dots"); $("snd").innerHTML = ic("send");
  soon("grp", "groups", ["গ্রুপ", "Groups"]); soon("bro", "bcast", ["ব্রডকাস্ট", "Broadcasts"]);
}
function applyLang() {
  document.documentElement.lang = lang();
  document.querySelectorAll("[data-l]").forEach((el) => (el.textContent = t(...el.dataset.l.split("|"))));
  document.querySelectorAll("[data-p]").forEach((el) => (el.placeholder = t(...el.dataset.p.split("|"))));
  buildTabs();
}

function renderList() {
  const f = $("sq").value.toLowerCase();
  $("ltitle").textContent = showArch ? t("আর্কাইভ", "Archived") : t("চ্যাট", "Chats");
  const rows = Object.entries(contacts()).filter(([, v]) => v.state !== "blocked" && !!v.arch === showArch)
    .map(([id, v]) => ({ id, v, m: chat(id).at(-1) }))
    .filter(({ v, m }) => !f || v.name.toLowerCase().includes(f) || m?.x.toLowerCase().includes(f))
    .sort((a, b) => !!b.v.pin - !!a.v.pin || (b.m?.t || 0) - (a.m?.t || 0))
    .map(({ id, v, m }) => `<div class="row" data-id="${id}">${avatar(v, v.name)}<div class="rt"><div class="rn"><b>${v.pin ? "📌 " : ""}${esc(v.name)}${v.state === "pending" ? esc(" " + tr("(অনুরোধ)")) : ""}</b><small>${m ? fmt(m.t) : ""}</small></div><small>${esc(m ? tr(m.x) : "")}${v.mute ? " 🔇" : ""}</small></div></div>`);
  $("rows").innerHTML = rows.join("") || `<p class="empty">${esc(tr(showArch ? "আর্কাইভ খালি" : "কোনো চ্যাট নেই। ➕ চেপে কন্টাক্ট যোগ করুন।"))}</p>`;
  document.querySelectorAll(".row").forEach((r) => (r.onclick = () => openChat(r.dataset.id)));
}

// প্রোফাইল শেয়ার
const profilePayload = () => { const v = (k) => pref("v." + k, "contacts") !== "none"; return { k: "pf", ...(v("a") && { a: pref("about", "") }), ...(v("p") && { p: pref("photo", "") }), ...(v("n") && { n: myName() }) }; };
const sendProfile = (id) => tx(id, profilePayload()).catch(() => {});
const broadcastProfile = () => Object.entries(contacts()).filter(([, c]) => c.state === "ok").forEach(([id]) => sendProfile(id));
function gotProfile(f, p) {
  const c = contacts()[f], u = {};
  if (!c) { u.name = (p.n && String(p.n).slice(0, 30)) || "BLINQ " + f.slice(0, 5); u.state = "pending"; }
  if (typeof p.a === "string") u.about = p.a.slice(0, 60);
  if (typeof p.p === "string") u.photo = p.p.length <= 40000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.p) ? p.p : "";
  if (p.n) { u.pname = String(p.n).slice(0, 30); if (c && !c.renamed) u.name = u.pname; }
  saveContact(f, u);
}
chatExtra.push((id, c) => [t("✏️ নাম বদলান", "✏️ Rename"), () => { const n = prompt(t("নতুন নাম", "New name"), c.name); if (n && n.trim()) { saveContact(id, { name: n.trim().slice(0, 30), renamed: true }); openChat(id); } }]);

// You ট্যাব ও পেজ
let curPg = null, photoTmp = "";
function card(p, items) {
  const c = document.createElement("div"); c.className = "card";
  items.forEach(({ i, l, v, f }) => { const r = document.createElement("div"); r.className = "r"; r.innerHTML = `${i ? ic(i) : ""}<span class="l">${esc(l)}</span>${v ? `<span class="v">${esc(v)}</span>` : ""}${f ? ic("chev", 18) : ""}`; if (f) r.onclick = f; c.append(r); });
  p.append(c);
}
const ME = [
  [["key", ["অ্যাকাউন্ট", "Account"], "account"], ["lock", ["প্রাইভেসি", "Privacy"], "privacy"], ["chats", ["চ্যাট", "Chats"], "chatsp"], ["palette", ["চেহারা ও ভাষা", "Appearance"], "appearance"], ["bell", ["নোটিফিকেশন", "Notifications"], "notif"], ["storage", ["স্টোরেজ ও ডেটা", "Storage and data"], "storage"]],
  [["help", ["সাহায্য", "Help and feedback"], "help"], ["heart", ["বন্ধুকে আমন্ত্রণ", "Invite a friend"], "invite"]],
];
function youMenu(f) {
  const q = f.toLowerCase(); $("ym").innerHTML = "";
  ME.forEach((g) => { const items = g.filter(([, [b, e]]) => !q || t(b, e).toLowerCase().includes(q)).map(([i, [b, e], k]) => ({ i, l: t(b, e), f: () => (k === "invite" ? saveQR() : openPg(k)) })); if (items.length) card($("ym"), items); });
}
const copyId = () => navigator.clipboard?.writeText(me.id).then(() => toast(t("কপি হয়েছে", "Copied")), () => {});
function renderYou() {
  const name = myName() || t("নাম দিন", "Set your name"), about = pref("about", "");
  $("you").innerHTML = `<div class="top"><button class="cb" id="ys">${ic("search")}</button><span></span><button class="cb" id="yq">${ic("scan")}</button><button class="cb" id="ye">${ic("pencil")}</button></div>
<input id="ysq" class="sq" hidden placeholder="${esc(t("সেটিংস খুঁজুন", "Search settings"))}">
<div class="prof">${about ? `<div class="note">${esc(about)}</div>` : ""}<div id="yav">${avatar({ photo: pref("photo", "") }, name, 1)}</div><h2>${esc(name)}</h2><small id="idl">ID: ${esc(me.id.slice(0, 8))}…</small></div><div id="ym"></div>`;
  $("ys").onclick = () => { $("ysq").hidden = !$("ysq").hidden; $("ysq").value = ""; youMenu(""); };
  $("ysq").oninput = (e) => youMenu(e.target.value);
  $("yq").onclick = () => { show("add"); drawQR(); };
  $("ye").onclick = $("yav").onclick = () => openPg("edit");
  $("idl").onclick = copyId; youMenu("");
}
const VIS = () => ({ all: t("সবাই", "Everyone"), contacts: t("শুধু কন্টাক্ট", "Contacts only"), none: t("কেউ না", "Nobody") });
const visRow = (k, l) => ({ l, v: VIS()[pref("v." + k, "contacts")], f: () => sheet(Object.entries(VIS()).map(([x, lb]) => [lb, () => { setPref("v." + k, x); refreshPg(); }])) });
const optSheet = (opts, key) => sheet(opts.map(([v, l]) => [l, () => { setPref(key, v); refreshPg(); applyTheme(); applyLang(); }]));
const AL = () => [[0, t("সাথে সাথে", "Immediately")], [30, t("৩০ সেকেন্ড", "30 seconds")], [60, t("১ মিনিট", "1 minute")], [300, t("৫ মিনিট", "5 minutes")]];
const onOff = (k) => (pref(k, "0") === "1" ? t("চালু", "On") : t("বন্ধ", "Off"));
async function changePin() {
  if (pinSet() && !(await verifyPin(prompt(t("বর্তমান PIN", "Current PIN")) || ""))) return toast(t("PIN ভুল", "Wrong PIN"));
  const p = prompt(t("নতুন PIN (৪-৮ সংখ্যা)", "New PIN (4-8 digits)"));
  if (!/^\d{4,8}$/.test(p || "")) return toast(t("৪-৮ সংখ্যার PIN দিন", "Enter a 4-8 digit PIN"));
  await setPin(p); toast(t("PIN সেট হয়েছে", "PIN set")); refreshPg();
}
async function offPin() { if (!(await verifyPin(prompt("PIN") || ""))) return toast(t("PIN ভুল", "Wrong PIN")); setPref("pin", ""); setPref("bio", "0"); refreshPg(); }
async function toggleBio() {
  if (!pinSet()) return toast(t("আগে PIN সেট করুন", "Set a PIN first"));
  if (pref("bio", "0") === "1") { setPref("bio", "0"); return refreshPg(); }
  try {
    if (!(await BiometricAuth.checkBiometry()).isAvailable) return toast(t("এই ফোনে বায়োমেট্রিক নেই বা সেট করা নেই", "Biometric not available on this phone"));
    await BiometricAuth.authenticate({ reason: t("যাচাই করুন", "Verify") }); setPref("bio", "1"); refreshPg();
  } catch { toast(t("বায়োমেট্রিক ব্যর্থ", "Biometric failed")); }
}
const PG = {
  account: [["অ্যাকাউন্ট", "Account"], (b) => card(b, [{ i: "key", l: t("আপনার ID", "Your ID"), v: me.id.slice(0, 10) + "…", f: copyId }, { l: t("ব্যাকআপ", "Backup"), v: t("শীঘ্রই আসছে", "Coming soon") }, { l: t("সব ডেটা মুছুন", "Delete all data"), f: () => confirm("সব চ্যাট, কন্টাক্ট ও চাবি মুছে যাবে। নিশ্চিত?") && wipe() }])],
  privacy: [["প্রাইভেসি", "Privacy"], (b) => {
    card(b, [visRow("n", t("নাম কে দেখবে", "Who sees my name")), visRow("p", t("ছবি কে দেখবে", "Who sees my photo")), visRow("a", t("About কে দেখবে", "Who sees my About"))]);
    card(b, [
      { i: "lock", l: t("অ্যাপ লক (PIN)", "App lock (PIN)"), v: pinSet() ? t("চালু", "On") : t("বন্ধ", "Off"), f: () => sheet([[t("PIN সেট / বদলান", "Set / change PIN"), changePin], ...(pinSet() ? [[t("PIN বন্ধ করুন", "Turn off PIN"), offPin]] : [])]) },
      { l: t("বায়োমেট্রিক", "Biometric"), v: onOff("bio"), f: toggleBio },
      { l: t("অটো-লক", "Auto-lock"), v: (AL().find(([s]) => String(s) === pref("al", "30")) || [])[1], f: () => optSheet(AL(), "al") },
      { l: t("ভুল PIN ১০ বার হলে সব ডেটা মুছে যায়", "10 wrong PINs erase all data") },
    ]);
    card(b, [{ l: t("ব্লক করা কন্টাক্ট", "Blocked contacts"), v: String(Object.values(contacts()).filter((c) => c.state === "blocked").length), f: () => openPg("blocked") }]);
  }],
  blocked: [["ব্লক করা কন্টাক্ট", "Blocked contacts"], (b) => {
    const l = Object.entries(contacts()).filter(([, c]) => c.state === "blocked").map(([id, c]) => ({ l: c.name, v: t("আনব্লক", "Unblock"), f: () => { saveContact(id, { state: "ok" }); refreshPg(); } }));
    l.length ? card(b, l) : (b.innerHTML = `<p class="empty">${esc(t("কেউ ব্লক নেই", "No blocked contacts"))}</p>`);
  }],
  chatsp: [["চ্যাট", "Chats"], (b) => card(b, [{ l: t("আর্কাইভ করা চ্যাট", "Archived chats"), f: () => { showArch = true; show("list"); } }])],
  appearance: [["চেহারা ও ভাষা", "Appearance"], (b) => card(b, [
    { i: "palette", l: t("থিম", "Theme"), v: pref("theme", "dark") === "dark" ? t("ডার্ক", "Dark") : t("লাইট", "Light"), f: () => optSheet([["dark", t("ডার্ক", "Dark")], ["light", t("লাইট", "Light")]], "theme") },
    { l: t("ভাষা", "Language"), v: lang() === "en" ? "English" : "বাংলা", f: () => optSheet([["bn", "বাংলা"], ["en", "English"]], "lang") },
  ])],
  notif: [["নোটিফিকেশন", "Notifications"], (b) => card(b, [{ i: "bell", l: t("মেসেজ নোটিফিকেশন", "Message notifications"), v: t("শীঘ্রই আসছে", "Coming soon") }])],
  storage: [["স্টোরেজ ও ডেটা", "Storage and data"], (b) => {
    const ids = Object.keys(contacts());
    card(b, [{ l: t("চ্যাট", "Chats"), v: String(ids.length) }, { l: t("মেসেজ", "Messages"), v: String(ids.reduce((n, id) => n + chat(id).length, 0)) }, { l: t("সব চ্যাট মুছুন", "Clear all chats"), f: () => confirm(t("সব মেসেজ মুছে যাবে। নিশ্চিত?", "All messages will be deleted. Sure?")) && (ids.forEach((id) => saveChat(id, [])), refreshPg()) }]);
  }],
  help: [["সাহায্য", "Help and feedback"], (b) => card(b, [{ i: "help", l: t("ভার্সন", "Version"), v: "v" + pkg.version }, { l: "BLINQ", v: t("এনক্রিপ্টেড মেসেজিং", "Encrypted messaging") }])],
  edit: [["প্রোফাইল এডিট", "Edit profile"], (b) => {
    photoTmp = pref("photo", "");
    b.innerHTML = `<div class="prof" id="epw"></div><div class="card form"><label>${esc(t("নাম", "Name"))}<input id="en" maxlength="30"></label><label>About<input id="ea" maxlength="60"></label></div>
<div class="card"><div class="r" id="ech"><span class="l">${esc(t("ছবি বদলান", "Change photo"))}</span></div><div class="r" id="erm"><span class="l">${esc(t("ছবি সরান", "Remove photo"))}</span></div></div>
<div style="padding:0 16px"><button id="esv" style="width:100%">${esc(t("সেভ", "Save"))}</button></div><input type="file" id="ef" accept="image/*" hidden>`;
    $("en").value = myName(); $("ea").value = pref("about", "");
    const paint = () => ($("epw").innerHTML = avatar({ photo: photoTmp }, $("en").value || "?", 1));
    paint(); $("en").oninput = paint;
    $("ech").onclick = () => $("ef").click(); $("erm").onclick = () => { photoTmp = ""; paint(); };
    $("ef").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const bmp = await createImageBitmap(f), s = Math.min(bmp.width, bmp.height), c = document.createElement("canvas");
      c.width = c.height = 96; c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 96, 96);
      photoTmp = c.toDataURL("image/jpeg", 0.7); paint(); e.target.value = "";
    };
    $("esv").onclick = () => { setMyName($("en").value.trim()); setPref("about", $("ea").value.trim()); setPref("photo", photoTmp); broadcastProfile(); toast(t("সেভ হয়েছে", "Saved")); show("you"); };
  }],
};
function openPg(k) { curPg = k; const [[b, e], fn] = PG[k]; $("pgt").textContent = t(b, e); $("pgb").innerHTML = ""; fn($("pgb")); show("pg"); }
const refreshPg = () => curPg && openPg(curPg);

$("dotsb").onclick = () => sheet([[showArch ? t("চ্যাট", "Chats") : t("আর্কাইভ করা চ্যাট", "Archived chats"), () => { showArch = !showArch; renderList(); }], [t("কন্টাক্ট যোগ", "Add contact"), () => { show("add"); drawQR(); }]]);
$("scanb").onclick = () => { show("add"); drawQR(); startCam(); };
$("addb").onclick = () => { show("add"); drawQR(); };
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
$("pgback").onclick = () => show("you");
$("snd").onclick = send;
$("inp").onkeydown = (e) => { if (e.key === "Enter") send(); };
$("acc").onclick = () => { saveContact(cur, { state: "ok" }); $("req").hidden = true; sendProfile(cur); };
$("blk").onclick = () => { saveContact(cur, { state: "blocked" }); cur = null; show("list"); };

// ---- v0.4.0: নিরাপত্তা ----
const DIS = { 3600: "১ ঘণ্টা", 86400: "১ দিন", 604800: "৭ দিন" };
const wipe = () => { localStorage.clear(); location.reload(); };
const pinSet = () => !!pref("pin", "");
const rnd = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
async function hashPin(pin, salt) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 200000, hash: "SHA-256" }, k, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
async function setPin(p) { const s = rnd(); setPref("pin", s + ":" + (await hashPin(p, s))); }
async function verifyPin(p) { const [s, h] = pref("pin", ":").split(":"); return !!p && (await hashPin(p, s)) === h; }
const unlock = () => { setPref("fails", "0"); $("lock").hidden = true; purge(); };
let pinBuf = "";
const dots = () => ($("dots").textContent = "●".repeat(pinBuf.length) || "—");
async function tryBio() { if (pref("bio", "0") !== "1") return; try { await BiometricAuth.authenticate({ reason: "BLINQ খুলুন" }); unlock(); } catch {} }
function lock() { if (!pinSet()) return; $("lock").hidden = false; pinBuf = ""; dots(); $("lerr").textContent = ""; $("bio").hidden = pref("bio", "0") !== "1"; tryBio(); }

// ডিজঅ্যাপিয়ারিং মেসেজ
function purge() {
  const n = Date.now();
  for (const id of Object.keys(contacts())) { const m = chat(id), k = m.filter((x) => !x.exp || x.exp > n); if (k.length !== m.length) saveChat(id, k); }
  if (cur) renderMsgs(); if (!$("list").hidden) renderList();
}
function setDis(id, s, mine) {
  saveContact(id, { dis: s });
  addMsg(id, { i: uid(), o: 0, s: 1, x: "⏳ ডিজঅ্যাপিয়ারিং: " + (DIS[s] || "বন্ধ"), t: Date.now() });
  if (mine) tx(id, { k: "dis", s }).catch((e) => toast(e.message));
  if (cur === id) renderMsgs();
}
chatExtra.push((id, c) => ["⏳ ডিজঅ্যাপিয়ারিং" + (c.dis ? ": " + DIS[c.dis] : ""), () => sheet([["বন্ধ", 0], ["১ ঘণ্টা", 3600], ["১ দিন", 86400], ["৭ দিন", 604800]].map(([l, s]) => [l, () => setDis(id, s, true)]))]);
chatExtra.push((id, c) => ["🔐 নিরাপত্তা কোড", () => { const s = safety(id); alert(s ? `আপনার ও ${c.name}-এর কোড (দুজনের ফোনে হুবহু এক হতে হবে):\n\n${s}\n\nসামনাসামনি বা ফোনে মিলিয়ে নিন।` : "কোড এখনো তৈরি হয়নি, আগে একটা মেসেজ আদান-প্রদান করুন।"); }]);

$("unl").onclick = async () => {
  if (await verifyPin(pinBuf)) return unlock();
  const n = +pref("fails", "0") + 1; setPref("fails", n);
  if (n >= 10) return wipe();
  $("lerr").textContent = `ভুল PIN (আর ${10 - n} বার)`; pinBuf = ""; dots();
};
$("kp").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map((k) => `<button data-k="${k}">${k}</button>`).join("");
$("kp").onclick = (e) => {
  const k = e.target.dataset?.k; if (!k) return;
  if (k === "✓") return $("unl").click();
  pinBuf = k === "⌫" ? pinBuf.slice(0, -1) : pinBuf.length < 8 ? pinBuf + k : pinBuf; dots();
};
$("bio").onclick = tryBio;
$("wrs").onclick = () => { resetPeer(cur); saveContact(cur, { warn: false }); $("warn").hidden = true; alert("পুরনো চাবি মুছে ফেলা হয়েছে। অপর জনের QR আবার স্ক্যান করে নিরাপত্তা কোড মিলিয়ে নিন।"); };
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); $("cover").hidden = false; }
  else { $("cover").hidden = true; if (pinSet() && Date.now() - hiddenAt >= +pref("al", "30") * 1000) lock(); }
});
setInterval(purge, 15000);

(async () => {
  applyTheme();
  me = await loadOrCreateIdentity(); await initSignal();
  $("myname").value = myName();
  connect(me, onMsg, (s) => ($("st").textContent = tr(s)), (ws) => ws.send(JSON.stringify({ t: "prekeys", b: JSON.stringify(myBundle()) })));
  applyLang(); show("list"); purge(); lock();
})();
