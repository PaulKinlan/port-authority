// The worker behind the journal on /comlink/. It keeps a real file in this
// origin's private file system. A sync access handle is an exclusive lock:
// while one is open, nobody else can open the file, so forgetting to close it
// is a bug you can see.
import { expose, give } from "/hawser.js";

let open = 0;
class Journal {
  #handle;
  constructor(handle) { this.#handle = handle; open++; }
  append(line) {
    const bytes = new TextEncoder().encode(line.replace(/\n/g, " ") + "\n");
    this.#handle.write(bytes, { at: this.#handle.getSize() });
    this.#handle.flush();
  }
  read() {
    const bytes = new Uint8Array(this.#handle.getSize());
    this.#handle.read(bytes, { at: 0 });
    return new TextDecoder().decode(bytes).split("\n").filter(Boolean);
  }
  clear() { this.#handle.truncate(0); this.#handle.flush(); }
  [Symbol.dispose]() { this.#handle.close(); open--; }
}

const api = {
  async open(name) {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle(name, { create: true });
    // give(): by reference, and the caller's to dispose of. When they let go,
    // however that happens, Journal[Symbol.dispose] runs here.
    return give(new Journal(await file.createSyncAccessHandle()));
  },
  handlesOpen: () => open,
};

// A page can close its link and open another. Serve each one afresh.
const serve = () => expose(api, self, { onclose: serve });
serve();
