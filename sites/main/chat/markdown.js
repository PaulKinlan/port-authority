// Turn the Markdown a model writes into HTML that is safe to put on the page.
//
// A model's answer is text from somewhere else, so nothing in it is trusted:
//   - every character of it is escaped before any tag is added
//   - the only tags are the ones this file writes
//   - a link is kept only if it starts with http:, https: or mailto:
//   - an image is never loaded. It is shown as a link. A page that loads an
//     image a model named can be made to send the conversation to that address.
//
// It covers what models write: paragraphs, headings, lists, code, quotes,
// tables, rules, links, bold, italic and strike-through. It is not a full
// Markdown parser.
//
//   render(text, { highlight })   highlight(code, lang) may return HTML for a code block

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const OPEN = "\uE000", CLOSE = "\uE001";    // mark a piece of finished HTML inside text that is still being read
const safeLink = (url) => /^(https?:\/\/|mailto:)/i.test(url);
const anchor = (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">`;

// The markup inside a line or a paragraph.
function inline(source) {
  const kept = [];
  const keep = (html) => { kept.push(html); return OPEN + (kept.length - 1) + CLOSE; };
  let text = source
    // Code first: nothing inside it is markup.
    .replace(/(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g, (_, ticks, code) => keep(`<code>${esc(code.replace(/^ (.+) $/s, "$1"))}</code>`))
    // A backslash makes the next character plain.
    .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_, c) => keep(esc(c)));
  text = esc(text);
  const link = (label, url) => (safeLink(url) ? keep(anchor(url)) + label + keep("</a>") : null);
  text = text
    .replace(/!\[([^\]]*)\]\(([^)\s\uE000\uE001]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (all, alt, url) => link(alt || "image", url) ?? all)
    .replace(/\[([^\]]+)\]\(([^)\s\uE000\uE001]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (all, label, url) => link(label, url) ?? all)
    // An address written out on its own.
    .replace(/(^|[\s(])(https?:\/\/[^\s<\uE000\uE001]*[^\s<\uE000\uE001.,;:!?)\]])/g, (_, lead, url) => lead + keep(anchor(url) + url + "</a>"))
    .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![\w_])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w_])/g, "<strong>$1</strong>")
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, "<em>$1</em>")
    .replace(/(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g, "<em>$1</em>")
    .replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, "<del>$1</del>")
    .replace(/(?: {2,}|\\)?\n/g, "<br>\n");
  return text.replace(/\uE000(\d+)\uE001/g, (_, n) => kept[n]);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
const indentOf = (line) => line.length - line.trimStart().length;
const tableAt = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && DIVIDER.test(lines[i + 1]) && cells(lines[i]).length === cells(lines[i + 1]).length;
// A line that ends the paragraph before it.
const breaks = (lines, i) => FENCE.test(lines[i]) || HEADING.test(lines[i]) || RULE.test(lines[i]) || QUOTE.test(lines[i]) || /^ {0,3}([-*+]|1[.)]) +\S/.test(lines[i]) || tableAt(lines, i);

function blocks(lines, options) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }

    if ((m = FENCE.exec(line))) {
      const close = new RegExp("^ {0,3}" + m[1][0] + "{" + m[1].length + ",}\\s*$");
      const body = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      i++;   // the closing fence. An answer that is still arriving may not have one yet.
      const code = body.join("\n"), lang = m[2].toLowerCase().replace(/[^a-z0-9+#.-]/g, "").slice(0, 20);
      let html = null;
      try { html = options.highlight ? options.highlight(code, lang) : null; } catch { /* show it plain */ }
      out.push(`<div class="code"><div class="code-bar"><span>${esc(lang || "code")}</span><button type="button" class="tiny quiet" data-copy-code>Copy</button></div><pre><code>${html ?? esc(code)}</code></pre></div>`);
      continue;
    }
    if ((m = HEADING.exec(line))) {
      // The page has its own h1 and h2, so a heading in an answer starts at h3.
      const level = Math.min(6, m[1].length + 2);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) { out.push("<hr>"); i++; continue; }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(lines[i++].replace(/^ {0,3}> ?/, ""));
      out.push(`<blockquote>${blocks(quoted, options)}</blockquote>`);
      continue;
    }
    if (tableAt(lines, i)) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
      const cell = (tag, text, n) => `<${tag}${align[n] ? ` class="${align[n]}"` : ""}>${inline(text || "")}</${tag}>`;
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, n) => cell("th", c, n)).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${head.map((_, n) => cell("td", row[n], n)).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if ((m = ITEM.exec(line))) {
      const ordered = /\d/.test(m[2]);
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items = [];
      let loose = false;
      while (i < lines.length && (m = ITEM.exec(lines[i])) && /\d/.test(m[2]) === ordered) {
        const indent = m[1].length + m[2].length + Math.max(1, Math.min(m[3].length, 4));
        const body = [m[4]];
        i++;
        for (;;) {
          if (i >= lines.length) break;
          if (!lines[i].trim()) {
            let next = i;
            while (next < lines.length && !lines[next].trim()) next++;
            if (next < lines.length && indentOf(lines[next]) >= indent) { while (i < next) { body.push(""); i++; } loose = true; continue; }
            break;
          }
          if (indentOf(lines[i]) >= indent) { body.push(lines[i].slice(indent)); i++; continue; }
          if (ITEM.test(lines[i]) || breaks(lines, i)) break;
          body.push(lines[i].trim());   // a paragraph that carries on without its indent
          i++;
        }
        items.push(body);
        // A blank line between two items of the same list does not end the list.
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next > i) {
          const after = next < lines.length ? ITEM.exec(lines[next]) : null;
          if (after && /\d/.test(after[2]) === ordered) { loose = true; i = next; } else break;
        }
      }
      const tag = ordered ? "ol" : "ul";
      const inner = items.map((body) => {
        const html = blocks(body, options);
        // In a list with no blank lines, an item's text is not a paragraph of its own.
        return `<li>${loose ? html : html.replace(/^<p>([\s\S]*?)<\/p>/, "$1")}</li>`;
      }).join("");
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${inner}</${tag}>`);
      continue;
    }

    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !breaks(lines, i)) paragraph.push(lines[i++]);
    out.push(`<p>${inline(paragraph.map((l) => l.trimStart()).join("\n"))}</p>`);
  }
  return out.join("");
}

export function render(source, options = {}) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n").replace(/[\uE000\uE001]/g, "").replace(/\t/g, "    ");
  return blocks(text.split("\n"), options);
}
