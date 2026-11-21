// Checks every address in sites/shared/refs.js: the page must answer, and
// where the address has a #fragment the page must contain that anchor.
// Run: node scripts/check-refs.mjs
import { refs } from "../sites/shared/refs.js";

const pages = new Map();
const get = (url) => {
  if (!pages.has(url)) pages.set(url, fetch(url, { redirect: "follow", headers: { "user-agent": "refs-check" } }).then(async (r) => ({ status: r.status, final: r.url, body: r.ok ? await r.text() : "" })).catch((e) => ({ status: 0, final: url, body: "", error: String(e.cause || e) })));
  return pages.get(url);
};

let bad = 0;
const check = async (name, url) => {
  const [page, hash] = url.split("#");
  const got = await get(page);
  const problems = [];
  if (got.status !== 200) problems.push(`answered ${got.status || got.error}`);
  else {
    // A front page that sends you to its introduction is fine. A moved document is not.
    if (got.final.split(/[?#]/)[0] !== page && new URL(page).pathname !== "/") problems.push(`moved to ${got.final}`);
    if (hash && !new RegExp(`\\b(id|name)=["']?${hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\\s>]`, "i").test(got.body)) problems.push(`has no anchor #${hash}`);
  }
  if (problems.length) { bad++; console.log(`FAIL ${name}\n     ${url}\n     ${problems.join("; ")}`); }
};

const jobs = [];
for (const ref of refs) {
  if (ref.mdn) jobs.push(check(ref.name, ref.mdn));
  if (ref.spec) jobs.push(check(ref.name + " (spec)", ref.spec[0]));
  if (ref.url) jobs.push(check(ref.name, ref.url));
}
await Promise.all(jobs);
console.log(bad ? `${bad} of ${jobs.length} addresses need attention` : `all ${jobs.length} addresses answer`);
process.exit(bad ? 1 : 0);
