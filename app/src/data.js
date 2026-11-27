const L = (k, d) => JSON.parse(localStorage.getItem("blinq.d." + k) || d);
const S = (k, v) => localStorage.setItem("blinq.d." + k, JSON.stringify(v));
export const contacts = () => L("c", "{}");
export const saveContact = (id, c) => { const all = contacts(); all[id] = { ...all[id], ...c }; S("c", all); };
export const chat = (id) => L("m." + id, "[]");
export const addMsg = (id, o, x) => { const m = chat(id); m.push({ o, x, t: Date.now() }); S("m." + id, m); };
export const myName = () => localStorage.getItem("blinq.name") || "";
export const setMyName = (n) => localStorage.setItem("blinq.name", n);
