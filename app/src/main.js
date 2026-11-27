import pkg from "../package.json";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { loadOrCreateIdentity } from "./identity.js";
import { connect, RELAY } from "./relay.js";
import { initSignal, myBundle, myIk, startSession, encrypt, decrypt } from "./signal.js";
import { contacts, saveContact, chat, addMsg, myName, setMyName } from "./data.js";

const $ = (i) => document.getElementById(i);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (s) => { const t = $("toast"); t.textContent = s; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3000); };
let me, cur = null, q = Promise.resolve(), stream = null;
const run = (fn) => { const p = q.then(fn); q = p.catch(() => {}); return p; }; // ratchet অবস্থা একটা একটা করে বদলায়
const show = (v) => { for (const x of ["list", "chat", "add"]) $(x).hidden = x !== v; if (v === "list") renderList(); };

function renderList() {
  const rows = Object.entries(contacts()).filter(([, v]) => v.state !== "blocked").map(([id, v]) => {
    const m = chat(id).at(-1);
    return `<div class="row" data-id="${id}"><div class="av">${esc((v.name || "?")[0])}</div><div><b>${esc(v.name)}${v.state === "pending" ? " (অনুরোধ)" : ""}</b><br><small>${esc(m ? m.x : "")}</small></div></div>`;
  });
  $("rows").innerHTML = rows.join("") || '<p class="empty">কোনো চ্যাট নেই। ➕ চেপে কন্টাক্ট যোগ করুন।</p>';
  document.querySelectorAll(".row").forEach((r) => (r.onclick = () => openChat(r.dataset.id)));
}
function renderMsgs() {
  if (!cur) return;
  $("msgs").innerHTML = chat(cur).map((m) => `<div class="b ${m.o ? "o" : "i"}">${esc(m.x)}</div>`).join("");
  $("msgs").scrollTop = 1e9;
}
function openChat(id) {
  cur = id; const c = contacts()[id];
  $("cname").textContent = c.name; $("req").hidden = c.state !== "pending";
  renderMsgs(); show("chat");
}

async function send() {
  const x = $("inp").value.trim(), id = cur; if (!x || !id) return; $("inp").value = "";
  try {
    await run(async () => {
      const e = await encrypt(id, JSON.stringify({ x, n: myName() }));
      const r = await fetch(`${RELAY}/send/${id}`, { method: "POST", body: btoa(JSON.stringify({ f: me.id, ...e })) });
      if (r.status !== 202) throw new Error("রিলে " + r.status);
    });
    addMsg(id, 1, x);
  } catch (e) { toast("পাঠানো যায়নি: " + e.message); }
  renderMsgs();
}

const seen = new Set();
const onMsg = (m) => run(async () => {
  if (seen.has(m.id)) return; seen.add(m.id);
  try {
    const { f, t, b } = JSON.parse(atob(m.d));
    const c = contacts()[f];
    if (c?.state === "blocked") return;
    const p = JSON.parse(await decrypt(f, t, b));
    if (!c) saveContact(f, { name: p.n || "অজানা " + f.slice(0, 5), state: "pending" });
    addMsg(f, 0, p.x);
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
  } catch { toast("ক্যামেরা চালু হয়নি"); }
}
$("pick").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const bmp = await createImageBitmap(f), s = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = bmp.width * s; c.height = bmp.height * s;
  const x = c.getContext("2d"); x.drawImage(bmp, 0, 0, c.width, c.height);
  const r = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  r ? addFromText(r.data) : toast("QR পাওয়া যায়নি"); e.target.value = "";
};

const drawQR = () => QRCode.toDataURL(JSON.stringify({ v: 1, id: me.id, ik: myIk(), n: myName() }), { width: 280, margin: 2 }).then((u) => ($("qr").src = u));
$("addb").onclick = () => { show("add"); drawQR(); };
$("myname").onchange = (e) => { setMyName(e.target.value.trim()); drawQR(); };
$("cam").onclick = startCam;
$("back").onclick = () => { cur = null; show("list"); };
$("back2").onclick = () => { stopCam(); show("list"); };
$("snd").onclick = send;
$("inp").onkeydown = (e) => e.key === "Enter" && send();
$("acc").onclick = () => { saveContact(cur, { state: "ok" }); $("req").hidden = true; };
$("blk").onclick = () => { saveContact(cur, { state: "blocked" }); cur = null; show("list"); };

(async () => {
  me = await loadOrCreateIdentity(); await initSignal();
  $("ver").textContent = "v" + pkg.version; $("myname").value = myName();
  connect(me, onMsg, (s) => ($("st").textContent = s), (ws) => ws.send(JSON.stringify({ t: "prekeys", b: JSON.stringify(myBundle()) })));
  show("list");
})();
