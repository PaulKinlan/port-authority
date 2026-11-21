// Used by the picker window (seal) and by the worker inside the router frame (unseal).

// Encrypt the API key so that the copy kept inside a site can only be read
// with the unlock key the server hands out while the grant is good.
const bytes = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const text64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const aes = (wrap) => crypto.subtle.importKey("raw", bytes(wrap).slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
export async function seal(wrap, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(wrap), new TextEncoder().encode(secret));
  return { iv: text64(iv), data: text64(data) };
}
export async function unseal(wrap, sealed) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, await aes(wrap), bytes(sealed.data));
  return new TextDecoder().decode(data);
}
