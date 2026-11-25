// The conversations, kept in this browser.
//
// They are in IndexedDB under this site's address. Nothing here is sent to a
// server: the only place a conversation goes is to the model, when you send a
// message.
//
// One record for each conversation:
//   { id, title, named, created, updated, system, messages: [
//       { id, role: "user" | "assistant", content, at, model, usage, stopped, error } ] }
//   named:   true once the person has typed a title, so it is not replaced
//   system:  instructions sent before the messages, if any
//   stopped: the person stopped the answer part way
//   error:   { message, code, status } when the answer failed

const NAME = "chat";
const STORE = "conversations";

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

let opening = null;
function database() {
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("updated", "updated");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error("Another tab is holding an older copy of the conversations open.")); };
  });
}
const store = async (mode) => (await database()).transaction(STORE, mode).objectStore(STORE);

export const newId = () => crypto.randomUUID();

// Every conversation, newest first.
export async function all() {
  const list = await done((await store("readonly")).getAll());
  return list.sort((a, b) => b.updated - a.updated);
}
export async function get(id) { return (await done((await store("readonly")).get(id))) || null; }
export async function save(conversation) { await done((await store("readwrite")).put(conversation)); }
export async function remove(id) { await done((await store("readwrite")).delete(id)); }

// A conversation read from a file. Anything that is not the right shape is
// left out, and every text is kept as text.
export function clean(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.messages)) return null;
  const text = (value, most) => (typeof value === "string" ? value.slice(0, most) : "");
  const time = (value) => (Number.isFinite(value) ? value : Date.now());
  const messages = raw.messages
    .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      id: newId(), role: m.role, content: m.content, at: time(m.at),
      ...(typeof m.model === "string" ? { model: m.model.slice(0, 200) } : {}),
      ...(m.stopped === true ? { stopped: true } : {}),
      ...(m.error && typeof m.error === "object" && typeof m.error.message === "string" ? { error: { message: m.error.message.slice(0, 2000), code: text(m.error.code, 60) || undefined } } : {}),
    }));
  if (!messages.length) return null;
  return { id: newId(), title: text(raw.title, 200) || "Imported conversation", named: raw.named === true, created: time(raw.created), updated: time(raw.updated), system: text(raw.system, 20000), messages };
}
