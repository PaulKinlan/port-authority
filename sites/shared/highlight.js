// Lightweight, zero-dependency syntax highlighter for Port Authority code blocks.
// Supports JavaScript (default) and shell commands (`data-command` / `data-lang="sh"`).

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
  "default", "delete", "do", "else", "export", "extends", "finally", "for", "from",
  "function", "if", "import", "in", "instanceof", "let", "new", "of", "return",
  "static", "super", "switch", "this", "throw", "try", "typeof", "using", "var",
  "void", "while", "yield",
]);

const ATOMS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const TYPES = new Set([
  "AbortController", "AbortSignal", "Array", "ArrayBuffer", "Atomics", "AudioContext",
  "AudioData", "AudioWorkletNode", "BigInt", "Blob", "BroadcastChannel", "CompressionStream",
  "CryptoKey", "CustomEvent", "DOMException", "Date", "DecompressionStream",
  "EncodedAudioChunk", "EncodedVideoChunk", "Error", "Event", "EventTarget", "File",
  "FileSystemFileHandle", "FileSystemWritableFileStream", "FinalizationRegistry",
  "Float32Array", "FormData", "Function", "Headers", "ImageBitmap", "ImageData",
  "Int32Array", "JSON", "Map", "Math", "MediaSourceHandle", "MediaStream",
  "MediaStreamTrack", "MessageChannel", "MessagePort", "Number", "Object",
  "OffscreenCanvas", "Promise", "Proxy", "RTCDataChannel", "RTCPeerConnection",
  "RangeError", "ReadableStream", "Reflect", "RegExp", "Request", "Response",
  "ServiceWorker", "Set", "SharedArrayBuffer", "SharedWorker", "String", "Symbol",
  "TextDecoder", "TextEncoder", "TransformStream", "TypeError", "URL", "Uint8Array",
  "VideoFrame", "WeakMap", "WeakRef", "WeakSet", "WebSocket", "WebSocketStream",
  "Worker", "WritableStream", "clients", "console", "crypto", "document", "fetch",
  "location", "navigator", "parent", "performance", "self", "structuredClone", "window",
]);

// Single-pass JS tokenizer: comments and strings match first so `https://...`
// inside quotes is never treated as a `//` comment.
const JS_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?\b|\b[A-Za-z_$][\w$]*\b/g;

function highlightTemplate(raw) {
  let out = '<span class="hl-s">`';
  let i = 1;
  const end = raw.length - 1;
  while (i < end) {
    const idx = raw.indexOf("${", i);
    if (idx === -1 || idx >= end) {
      out += esc(raw.slice(i, end));
      break;
    }
    // Check for escaped \${
    let slashes = 0;
    for (let k = idx - 1; k >= i && raw[k] === "\\"; k--) slashes++;
    if (slashes % 2 === 1) {
      out += esc(raw.slice(i, idx + 2));
      i = idx + 2;
      continue;
    }
    out += esc(raw.slice(i, idx));
    // Find matching closing brace for interpolation
    let depth = 1, j = idx + 2;
    while (j < end && depth > 0) {
      const ch = raw[j];
      if (ch === "\\" && j + 1 < end) { j += 2; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    if (depth === 0) {
      const expr = raw.slice(idx + 2, j - 1);
      out += '</span><span class="hl-p">${</span>' + highlightJS(expr) + '<span class="hl-p">}</span><span class="hl-s">';
      i = j;
    } else {
      out += esc(raw.slice(idx, end));
      break;
    }
  }
  return out + "`</span>";
}

export function highlightJS(code) {
  let out = "";
  let last = 0;
  const re = new RegExp(JS_RE.source, "g");
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const tok = m[0];
    const ch = tok[0];
    if (ch === "/" && (tok[1] === "/" || tok[1] === "*")) {
      out += `<span class="hl-c">${esc(tok)}</span>`;
    } else if (ch === "`") {
      out += highlightTemplate(tok);
    } else if (ch === '"' || ch === "'") {
      out += `<span class="hl-s">${esc(tok)}</span>`;
    } else if (ch >= "0" && ch <= "9") {
      out += `<span class="hl-n">${esc(tok)}</span>`;
    } else {
      const prevChar = code.slice(0, m.index).trimEnd().slice(-1);
      const nextChar = code.slice(re.lastIndex).trimStart()[0];
      if (prevChar === ".") {
        out += nextChar === "(" ? `<span class="hl-f">${esc(tok)}</span>` : esc(tok);
      } else if (KEYWORDS.has(tok)) {
        out += `<span class="hl-k">${esc(tok)}</span>`;
      } else if (ATOMS.has(tok)) {
        out += `<span class="hl-n">${esc(tok)}</span>`;
      } else if (TYPES.has(tok)) {
        out += `<span class="hl-t">${esc(tok)}</span>`;
      } else if (nextChar === "(") {
        out += `<span class="hl-f">${esc(tok)}</span>`;
      } else {
        out += esc(tok);
      }
    }
    last = re.lastIndex;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

const SH_RE = /#[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:[^'\n])*'|https?:\/\/[^\s"'\\]+|(?:^|(?<=\s))--?[A-Za-z0-9_-]+(?==|\s|$)|\$\{?[A-Za-z_][\w]*\}?/g;
const SH_CMDS = new Set(["curl", "node", "npm", "npx", "claude", "gemini", "codex", "opencode", "git", "cd", "export"]);

export function highlightShell(code) {
  return code.split("\n").map((line) => {
    let out = "";
    let last = 0;
    let firstWord = true;
    SH_RE.lastIndex = 0;
    let m;
    while ((m = SH_RE.exec(line)) !== null) {
      if (m.index > last) {
        const gap = line.slice(last, m.index);
        if (firstWord && gap.trim()) {
          out += gap.replace(/^(\s*)([A-Za-z0-9_./-]+)/, (_, ws, cmd) =>
            ws + (SH_CMDS.has(cmd) ? `<span class="hl-k">${esc(cmd)}</span>` : esc(cmd))
          );
          firstWord = false;
        } else {
          out += esc(gap);
        }
      }
      const tok = m[0];
      if (tok[0] === "#") out += `<span class="hl-c">${esc(tok)}</span>`;
      else if (tok[0] === '"' || tok[0] === "'") out += `<span class="hl-s">${esc(tok)}</span>`;
      else if (tok.startsWith("http://") || tok.startsWith("https://")) out += `<span class="hl-s">${esc(tok)}</span>`;
      else if (tok[0] === "-") out += `<span class="hl-t">${esc(tok)}</span>`;
      else if (tok[0] === "$") out += `<span class="hl-n">${esc(tok)}</span>`;
      else out += esc(tok);
      if (tok.trim()) firstWord = false;
      last = SH_RE.lastIndex;
    }
    if (last < line.length) {
      const rest = line.slice(last);
      if (firstWord && rest.trim()) {
        out += rest.replace(/^(\s*)([A-Za-z0-9_./-]+)/, (_, ws, cmd) =>
          ws + (SH_CMDS.has(cmd) ? `<span class="hl-k">${esc(cmd)}</span>` : esc(cmd))
        );
      } else {
        out += esc(rest);
      }
    }
    return out;
  }).join("\n");
}

export function highlightCode(code, lang = "js") {
  return lang === "sh" || lang === "shell" || lang === "bash"
    ? highlightShell(code)
    : highlightJS(code);
}

const SKIP_PRE = ".note, [data-no-hl], [data-file], [data-far], .demo pre, .fx pre";

export function highlightAll(root = document) {
  if (!root?.querySelectorAll) return;
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.matches(SKIP_PRE)) continue;
    const raw = pre.textContent || "";
    if (!raw.trim()) continue;
    if (pre.dataset.hlText === raw) continue;
    const lang = pre.dataset.lang || (pre.hasAttribute("data-command") ? "sh" : "js");
    pre.innerHTML = highlightCode(raw, lang);
    pre.dataset.hlText = raw;
    pre.classList.add("hl");
  }
}
