import { KeyHelper, SignalProtocolAddress, SessionBuilder, SessionCipher } from "@privacyresearch/libsignal-protocol-typescript";

const b2s = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const s2b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
const enc = (v) => v instanceof ArrayBuffer ? { $b: b2s(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v;
const dec = (v) => v && v.$b !== undefined ? s2b(v.$b) : Array.isArray(v) ? v.map(dec) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)])) : v;
const get = (k) => { const r = localStorage.getItem("blinq." + k); return r === null ? undefined : dec(JSON.parse(r)); };
const put = (k, v) => localStorage.setItem("blinq." + k, JSON.stringify(enc(v)));
const del = (k) => localStorage.removeItem("blinq." + k);

// Signal স্টোরেজ। TOFU: প্রথমবার দেখা চাবি বিশ্বাস, বদলালে ত্রুটি (সতর্কতার UI v0.4.0-এ)
const store = {
  getIdentityKeyPair: async () => get("ikp"),
  getLocalRegistrationId: async () => get("rid"),
  isTrustedIdentity: async (id, key) => { const k = get("ik." + id); return k === undefined || b2s(k) === b2s(key); },
  saveIdentity: async (id, key) => { const k = get("ik." + id); put("ik." + id, key); return k !== undefined && b2s(k) !== b2s(key); },
  loadPreKey: async (id) => get("pk." + id), storePreKey: async (id, kp) => put("pk." + id, kp), removePreKey: async (id) => del("pk." + id),
  loadSignedPreKey: async (id) => get("spk." + id), storeSignedPreKey: async (id, kp) => put("spk." + id, kp), removeSignedPreKey: async (id) => del("spk." + id),
  loadSession: async (id) => get("ses." + id), storeSession: async (id, rec) => put("ses." + id, rec),
};
const addr = (id) => new SignalProtocolAddress(id, 1);

export async function initSignal() {
  if (get("ikp")) return;
  put("ikp", await KeyHelper.generateIdentityKeyPair());
  put("rid", KeyHelper.generateRegistrationId());
  const spk = await KeyHelper.generateSignedPreKey(get("ikp"), 1);
  put("spk.1", spk.keyPair); put("spk.1.sig", spk.signature);
}
export const myIk = () => b2s(get("ikp").pubKey);
export const myBundle = () => ({ ik: myIk(), rid: get("rid"), spk: { id: 1, pk: b2s(get("spk.1").pubKey), sig: b2s(get("spk.1.sig")) } });

export const startSession = (id, b) => new SessionBuilder(store, addr(id)).processPreKey({
  registrationId: b.rid, identityKey: s2b(b.ik),
  signedPreKey: { keyId: b.spk.id, publicKey: s2b(b.spk.pk), signature: s2b(b.spk.sig) },
});
export async function encrypt(id, text) {
  const m = await new SessionCipher(store, addr(id)).encrypt(new TextEncoder().encode(text).buffer);
  return { t: m.type, b: m.body };
}
export async function decrypt(id, t, b) {
  const c = new SessionCipher(store, addr(id));
  const p = t === 3 ? await c.decryptPreKeyWhisperMessage(b, "binary") : await c.decryptWhisperMessage(b, "binary");
  return new TextDecoder().decode(p);
}
