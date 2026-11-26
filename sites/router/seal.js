// How the API key gets from the router window to the router frame, and how it
// is kept there. No server takes part.
//
// The frame makes a key pair and sends the public half to the window. The
// window encrypts the API key so that only the holder of the private half can
// open it, and sends that. The private half never leaves the frame, and the
// browser will not export it. So what crosses between the window and the frame
// is the encrypted key and nothing that opens it.
//
// The frame turns its private half into one key that can decrypt and do
// nothing else, and keeps that beside the encrypted API key. The page that
// calls the provider is handed both, and opens the API key in memory.
//
//   frame     const mine = await offer();          mine.pub goes to the window
//   window    const sealed = await reseal(pub, kept);   kept is the key as the window keeps it, itself encrypted
//   frame     const key = await mine.open(sealed.from);
//   call page const apiKey = await unseal(key, sealed);

const CURVE = { name: "ECDH", namedCurve: "P-256" };
const AES = { name: "AES-GCM", length: 256 };
const text64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const bytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const theirs = (jwk) => crypto.subtle.importKey("jwk", jwk, CURVE, false, []);

// The frame's half. `pub` can be posted anywhere. `open(from)` takes the
// window's public half and returns the key that decrypts what the window sealed.
export async function offer() {
  const pair = await crypto.subtle.generateKey(CURVE, false, ["deriveKey"]);
  return {
    pub: await crypto.subtle.exportKey("jwk", pair.publicKey),
    open: async (from) => crypto.subtle.deriveKey({ name: "ECDH", public: await theirs(from) }, pair.privateKey, AES, false, ["decrypt"]),
  };
}

// The window's half: encrypt `secret` for the holder of the private half of `pub`.
export async function seal(pub, secret) {
  const pair = await crypto.subtle.generateKey(CURVE, false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: await theirs(pub) }, pair.privateKey, AES, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  return { from: await crypto.subtle.exportKey("jwk", pair.publicKey), iv: text64(iv), data: text64(data) };
}

// The window's half, for an API key that the window itself keeps encrypted
// (store.js). kept is { sealed, key }. The browser opens it and encrypts it
// again for the frame in one go, as a key wrapped in a key: at no point is the
// API key text, or bytes, that the window's code can see.
export async function reseal(pub, kept) {
  if (kept.plain) return seal(pub, kept.plain);
  const pair = await crypto.subtle.generateKey(CURVE, false, ["deriveKey"]);
  const to = await crypto.subtle.deriveKey({ name: "ECDH", public: await theirs(pub) }, pair.privateKey, AES, false, ["wrapKey"]);
  // The API key is carried as the bytes of a key. HMAC is used only because such a key may be of any length.
  const inside = await crypto.subtle.unwrapKey("raw", bytes(kept.sealed.data), kept.key, { name: "AES-GCM", iv: bytes(kept.sealed.iv) }, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.wrapKey("raw", inside, to, { name: "AES-GCM", iv });
  return { from: await crypto.subtle.exportKey("jwk", pair.publicKey), iv: text64(iv), data: text64(data) };
}

export async function unseal(key, sealed) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, key, bytes(sealed.data)));
}
