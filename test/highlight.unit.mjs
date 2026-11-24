import test from "node:test";
import assert from "node:assert/strict";
import { highlightJS, highlightShell, highlightCode } from "../sites/shared/highlight.js";

test("highlights JS keywords, types, functions, strings, numbers, and comments", () => {
  const src = `// open a channel\nconst { port1, port2 } = new MessageChannel();\nport1.postMessage({ n: 42, ok: true, url: "https://port-authority.dev" });`;
  const html = highlightJS(src);
  assert.match(html, /<span class="hl-c">\/\/ open a channel<\/span>/);
  assert.match(html, /<span class="hl-k">const<\/span>/);
  assert.match(html, /<span class="hl-k">new<\/span> <span class="hl-t">MessageChannel<\/span>/);
  assert.match(html, /\.<span class="hl-f">postMessage<\/span>/);
  assert.match(html, /<span class="hl-n">42<\/span>/);
  assert.match(html, /<span class="hl-n">true<\/span>/);
  // URL inside string must stay a string, never split as a // comment
  assert.match(html, /<span class="hl-s">"https:\/\/port-authority\.dev"<\/span>/);
});

test("highlights template literals with embedded expressions and escapes HTML", () => {
  const src = 'const msg = `hello ${name < 3 ? "a&b" : count}`;';
  const html = highlightJS(src);
  assert.match(html, /<span class="hl-s">`hello <\/span>/);
  assert.match(html, /<span class="hl-p">\$\{<\/span>/);
  assert.match(html, /&lt; <span class="hl-n">3<\/span>/);
  assert.match(html, /<span class="hl-s">"a&amp;b"<\/span>/);
});

test("highlights shell commands, flags, and URLs", () => {
  const src = `curl -fsSLO https://port-authority.dev/bridge.mjs\nnode bridge.mjs --mcp "https://example.com" # start`;
  const html = highlightCode(src, "sh");
  assert.match(html, /<span class="hl-k">curl<\/span>/);
  assert.match(html, /<span class="hl-t">-fsSLO<\/span>/);
  assert.match(html, /<span class="hl-s">https:\/\/port-authority\.dev\/bridge\.mjs<\/span>/);
  assert.match(html, /<span class="hl-k">node<\/span>/);
  assert.match(html, /<span class="hl-t">--mcp<\/span>/);
  assert.match(html, /<span class="hl-c"># start<\/span>/);
});
