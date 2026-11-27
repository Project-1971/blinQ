import sodium from "libsodium-wrappers";

export const RELAY = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export function connect(me, onMessage, onStatus) {
  const ws = new WebSocket(RELAY.replace(/^http/, "ws") + "/ws/" + me.id);
  ws.onopen = () => onStatus("সংযোগ হচ্ছে…");
  ws.onclose = () => { onStatus("বিচ্ছিন্ন, আবার চেষ্টা হচ্ছে…"); setTimeout(() => connect(me, onMessage, onStatus), 3000); };
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "challenge") {
      const sig = sodium.crypto_sign_detached("mess-auth-v1:" + m.c, me.sk);
      ws.send(JSON.stringify({ t: "auth", sig: sodium.to_base64(sig, sodium.base64_variants.URLSAFE_NO_PADDING) }));
    } else if (m.t === "ready") {
      onStatus("সংযুক্ত ✅");
    } else if (m.t === "msg") {
      await onMessage(m);
      ws.send(JSON.stringify({ t: "ack", ids: [m.id] })); // প্রক্রিয়া শেষে তবেই ack
    }
  };
}
