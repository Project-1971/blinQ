import pkg from "../package.json";
import { loadOrCreateIdentity } from "./identity.js";
import { connect, RELAY } from "./relay.js";

const $ = (id) => document.getElementById(id);
const log = (s) => { $("log").textContent += s + "\n"; };

(async () => {
  $("v").textContent = "v" + pkg.version;
  const me = await loadOrCreateIdentity();
  $("id").textContent = me.id;
  connect(me, async (m) => log("পেলাম: " + atob(m.d)), (s) => { $("st").textContent = s; });
  $("t").onclick = async () => {
    try {
      const r = await fetch(`${RELAY}/send/${me.id}`, { method: "POST", body: btoa("hello " + new Date().toLocaleTimeString()) });
      log(r.status === 202 ? "পাঠানো হয়েছে" : "ত্রুটি " + r.status);
    } catch (e) { log("সংযোগ ব্যর্থ: " + e.message); }
  };
})();
