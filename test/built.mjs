// The ideas under "What you could build with it", built and running on each pattern's page.
// Needs `npx wrangler dev --port 8787` running, or LIVE=<workers.dev subdomain>.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const LIVE = process.env.LIVE;
const root = LIVE ? process.env.LIVE_MAIN || `https://portauthority.${LIVE}` : "http://hub.localhost:8787";
const shots = process.argv[2];
const browser = await chromium.launch(process.env.HTTPS_PROXY && LIVE ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const wait = (ms) => page.waitForTimeout(ms);
const flat = (t) => t.replace(/\n/g, " | ").slice(0, 240);
let at = "";
const open = async (pattern, id) => { at = "#" + id; await page.goto(`${root}/patterns/${pattern}/`); await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await page.locator(`${at} .stage-el`).scrollIntoViewIfNeeded(); await wait(700); };
const click = (label) => page.locator(`${at} .controls button`, { hasText: label }).click();
const frameText = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const boxText = (name) => page.locator(`${at} .box[data-name="${name}"]`).innerText();
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > end) return v; await wait(250); } };
const shot = async (name) => { if (shots) await page.locator(at).screenshot({ path: `${shots}/${name}.png` }); };

await open("canvas", "built-chart");
const order = await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return y("#demo") < y("#what") && y("#what") < y("#code") && y("#code") < y("#how") && y("#how") < y("#uses"); });
check("page order: the demo, then what it is, the code, how it works, what to build", order);
const pixels = () => page.locator(`${at} .box[data-name="page"] canvas`).screenshot().then((b) => b.toString("base64"));
const blank = await pixels();
await click("Ask the chart maker"); await wait(1500);
const first = await pixels();
await click("Send new numbers"); await wait(1500);
check("chart: another origin draws bars into this page's canvas, and redraws on new numbers", blank !== first && first !== (await pixels()) && /drew \d+, \d+/.test(await frameText("maker")), flat(await frameText("maker")));
await shot("built-chart");

await open("attenuate", "built-expiry");
await click("Lend the diary"); await click("Guest: ask"); await wait(900);
check("expiry: inside the time, the guest is answered", /today: dentist/.test(await frameText("guest")), flat(await frameText("guest")));
await until(async () => /Closed my end/.test(await boxText("page")), 12000);
await click("Guest: ask"); await wait(1200);
check("expiry: after it, the same port goes nowhere", /heard nothing/.test(await frameText("guest")), flat(await frameText("guest")));

await open("reply", "built-progress");
await click("Start a long job");
check("progress: progress arrives on the reply port and the job finishes", !!(await until(async () => /job 1 is ready/.test(await boxText("page")))), flat(await boxText("page")));
await click("Start a long job"); await wait(1000); await click("Cancel it"); await wait(1500);
const svc = await frameText("service");
check("progress: cancelling on the reply port stops the service's work", /job 2: cancelled at \d+%/.test(svc) && !/job 2: finished/.test(svc), flat(svc));

await open("halves", "built-sealed");
await click("Give each bidder"); await wait(500); await click("Bidder one: bid"); await click("Bidder two: bid"); await wait(900);
check("sealed: both bids arrive, and neither bidder can read", /bidder one bid \d+/.test(await boxText("page")) && /bidder two bid \d+/.test(await boxText("page")) && /can I read from it\? no/.test(await frameText("one")) && !/bidder/i.test((await frameText("two")).replace("Bidder two", "")), flat(await boxText("page")));
await click("Close the box"); await wait(300); await click("Bidder one: bid"); await wait(900);
check("sealed: after closing, a winner is named and late bids are refused", /wins with \d+/.test(await boxText("page")) && /refused: bidding has closed/.test(await frameText("one")), flat(await frameText("one")));

await open("functions", "built-listener");
await click("Let analytics listen"); await click("Press the page's button"); await click("Press the page's button"); await wait(700);
check("listener: clicks here are heard on another origin", /heard click 2: "Buy tulips"/.test(await frameText("analytics")), flat(await frameText("analytics")));
await click("Unsubscribe analytics"); await click("Press the page's button"); await wait(700);
check("listener: closing the port unsubscribes it", !/heard click 3/.test(await frameText("analytics")) && /pressed 3 times/.test((await boxText("page")).replace(/\n/g, " ")), flat(await boxText("page")));

await open("stream", "built-typing");
await click("Stream an answer"); await wait(1500);
const early = await frameText("viewer");
await wait(1500);
const later = await frameText("viewer");
check("typing: words appear on the other origin while the answer is still being written", /A port is one end/.test(early) && later.length > early.length + 20, flat(early));
await click("Stop writing"); await wait(700);
check("typing: stopping ends the stream and the viewer knows", /the answer ended after \d+ words/.test(await frameText("viewer")));

await open("signer", "built-cap");
await click("Let the shop charge"); for (let i = 0; i < 3; i++) { await click("Shop: charge 20"); await wait(700); }
const wallet = await frameText("wallet");
check("cap: two charges reach the wallet and the third is stopped before it", /balance 160/.test(wallet) && !/balance 140/.test(wallet) && /refused: over the limit of 50/.test(await frameText("shop")) && /refused 20: it would make 60/.test(await boxText("page")), flat(wallet));
await shot("built-cap");

await open("far", "built-approve");
await click("Open a line"); await click("Use a stand-in");
await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Pay 20" }).isDisabled()), 15000);
await click("Pay 20"); await wait(900);
check("approve: the question appears on the other device", /Pay 20 to the florist\?/.test(await frameText("far")), flat(await frameText("far")));
await click("Other device: approve");
check("approve: yes on the other device lets the checkout pay", !!(await until(async () => /approved on the other device\. Paid 20/.test(await boxText("page")))), flat(await boxText("page")));
await click("Pay 20"); await wait(700); await click("Other device: deny");
check("approve: no stops it", !!(await until(async () => /denied on the other device/.test(await boxText("page")))));
await shot("built-approve");

await open("lend", "built-tap");
await click("Open a connection");
await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Give the logger" }).isDisabled()));
await click("Give the logger"); await click("This page: say something"); await wait(1500); await click("Logger: try to speak"); await wait(500);
const lg = await frameText("logger");
check("tap: the logger hears the server and cannot speak", /logged: the server heard: hello 1/.test(lg) && /nothing to speak into/.test(lg) && /listening half only/.test(lg), flat(lg));

await open("introduce", "built-wire");
await click("Wire the two widgets"); await click("List: pick the next place"); await wait(900);
check("wire: the list moves the map with nothing through the page", /moved to 51\.478/.test(await frameText("map")) && /it says: showing Kew Gardens/.test(await frameText("list")) && !/Kew/.test(await boxText("page")), flat(await frameText("map")));

await open("attenuate", "built-chain");
await click("Give the assistant"); await click("Assistant: pass on"); await wait(600); await click("Intern: read"); await wait(900); await click("Intern: try to add"); await wait(900);
const intern1 = await frameText("intern");
check("chain: the intern reads through the assistant and cannot add", /read: 2 entries/.test(intern1) && /refused: this port is read only/.test(intern1) && /Entries: 2/.test((await boxText("page")).replace(/\n/g, " ")), flat(intern1));
await click("Owner: cut off"); await click("Intern: read"); await wait(1500);
check("chain: cutting off the assistant cuts off the intern", /asked, and heard nothing/.test(await frameText("intern")), flat(await frameText("intern")));

await open("exchange", "built-leader");
const tabText = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const leaders = async () => { const out = []; for (const n of ["tab-a", "tab-b", "tab-c"]) { if (!(await page.locator(`${at} .box[data-name="${n}"] iframe`).count())) continue; if (/I am the leader/.test(await tabText(n).catch(() => ""))) out.push(n); } return out; };
const one = await until(async () => { const l = await leaders(); return l.length === 1 && l; });
check("leader: exactly one of three tabs leads and runs the job", !!one && !!(await until(async () => /sync runs done by me: \d+/.test(await tabText(one[0])))), String(one));
await click("Close the leader");
const two = await until(async () => { const l = await leaders(); return l.length === 1 && l[0] !== one[0] && l; }, 12000);
check("leader: closing the leader promotes another tab", !!two, String(two));

await open("filter", "built-watermark");
const outPixels = () => page.locator(`${at} .box[data-name="out"] canvas`).screenshot().then((b) => b.toString("base64"));
const before = await outPixels();
await click("Start the video"); await wait(1500);
const mid = await outPixels();
check("watermark: frames come back from the plug-in drawn on", before !== mid && !!(await until(async () => /captioned \d+ frames/.test(await frameText("plugin")))), flat(await frameText("plugin")));
await click("Change the caption"); await wait(600);
check("watermark: the caption can be changed", /caption: Roses arrive/.test(await frameText("plugin")));

await open("zerocopy", "built-pool");
await click("Start the pool"); await wait(2500); await click("Stop"); await wait(400);
const pool = (await boxText("page")).replace(/\n/g, " ");
check("pool: two buffers make many round trips", /Buffers ever made: 2/.test(pool) && Number(pool.match(/Round trips: (\d+)/)?.[1]) >= 10 && /Copied: 0 MB/.test(pool), flat(pool));

await open("roundtrip", "built-cipher");
await click("Ask the cipher service");
await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Seal a line" }).isDisabled()));
await click("Seal a line");
check("cipher: a line is sealed by another origin and opened again", !!(await until(async () => /Deliver to 14 Mill Lane/.test(await boxText("out")))) && /sealed: [0-9a-f]{16}/.test(await boxText("page")) && !/Mill Lane/.test(await boxText("page")), flat(await boxText("page")));

await open("stream", "built-bigfile");
await click("Stream 64 MB");
const doneBig = await until(async () => /read all 64 MB/.test(await boxText("worker")), 25000);
const big = (await boxText("page")).replace(/\n/g, " ");
check("bigfile: 64 MB reaches the worker while a few MB at most are held", !!doneBig && /Made so far: 64/.test(big) && Number(big.match(/Most held at once: (\d+)/)?.[1]) <= 6, flat(big));

await open("keycopy", "built-keyworker");
await click("Make a key"); await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Ask the worker" }).isDisabled()));
await click("Ask the worker to sign"); await click("Page: try to sign"); await wait(900);
const kw = await boxText("page");
check("keyworker: the worker signs, the page verifies and cannot sign alone", /verified: "order 1"/.test(kw) && /I cannot sign/.test(kw) && /signed: order 1/.test(await boxText("worker")), flat(kw));

await open("functions", "built-method");
await click("Lend the badge"); await click("Add tulips"); await click("Badge: ask for the total"); await click("Badge: try to clear"); await wait(900);
const badge = await frameText("badge");
check("method: the badge can call total and cannot clear", /total\(\) returned 4\.5/.test(badge) && /clear\(\): not on this port/.test(badge) && /1 bunches/.test(await boxText("page")), flat(badge));

await open("reply", "built-rpc");
await click('"add", 2, 3'); await click('"divide", 1, 0'); await click("Three calls at once");
check("rpc: calls resolve, reject, and come back to the right caller", !!(await until(async () => /all three back: "first asked, last back", 42, "third asked"/.test(await boxText("page")))) && /resolved with 5/.test(await boxText("page")) && /rejected: cannot divide by zero/.test(await boxText("page")), flat(await boxText("page")));

await open("hello", "built-private");
await click("post the token to the window"); await wait(600);
const heardShout = /overheard token-1/.test(await boxText("snoop"));
await click("Open a private line"); await click("post the token down the line"); await wait(1000);
check("private: the window is overheard and the port is not", heardShout && /received token-2 on my port/.test(await boxText("page")) && !/overheard token-2/.test(await boxText("snoop")) && /heard nothing that time/.test(await boxText("snoop")), flat(await boxText("snoop")));

await open("attenuate", "built-narrow");
await click("Give the embed"); await click("Switch the theme"); await click("Add to the basket"); await click("Change the email"); await wait(500); await click("Embed: ask for the email"); await wait(800);
const emb = await frameText("embed");
check("narrow: the embed sees theme and basket, never the email", /dark theme, 1 in the basket/.test(emb) && /refused: email is not on this port/.test(emb) && !/example\.com/.test(emb) && /email changed: not in the view/.test(await boxText("page")), flat(emb));

await open("exchange", "built-sync");
const tab = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame();
await click("Tab one: add"); await click("Tab one: add"); await wait(800);
const both = (await tab("tab-one").locator("li").count()) === 2 && (await tab("tab-two").locator("li").count()) === 2;
await click("Tab two: tick"); await wait(800);
check("sync: an item added in one tab appears in the other, and a tick comes back", both && (await tab("tab-one").locator("li.done").count()) === 1, `${await tab("tab-two").locator("li").count()} items`);
await tab("tab-one").locator("li:nth-child(2) input").check(); await wait(600);
check("sync: the checkboxes inside a tab work too", (await tab("tab-two").locator("li.done").count()) === 2);

await open("canvas", "built-render");
const said = (name) => page.locator(`${at} .box[data-name="${name}"] [data-said]`).innerText();
await click("Draw on the page"); await until(async () => /frames, and you saw one/.test(await said("page")), 8000);
await click("Draw in the worker"); await until(async () => /each shown as it was finished/.test(await said("worker")), 8000);
const pageTicks = Number((await said("page")).match(/ticked (\d+) times/)?.[1]), workerTicks = Number((await said("worker")).match(/ticked (\d+) times/)?.[1]);
check("render: the page stalls drawing it itself and keeps ticking when a worker draws", pageTicks <= 2 && workerTicks >= 10, `${pageTicks} against ${workerTicks}`);

await open("zerocopy", "built-result");
await click("send a copy"); await until(async () => /copied: 16 MB arrived/.test(await boxText("page")), 15000);
await click("move it");
check("result: 16 MB comes back from the sandbox, and moving leaves it with none", !!(await until(async () => /moved: 16 MB arrived\. 1,077,871 primes/.test(await boxText("page")), 15000)) && /moved it in [\d.]+ ms\. I still hold 0 MB/.test(await frameText("sandbox")) && /copied it in [\d.]+ ms\. I still hold 16 MB/.test(await frameText("sandbox")), flat(await frameText("sandbox")));

await open("pipeline", "built-stages");
await click("Ask each party"); await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Pour a zipped" }).isDisabled()));
await click("Pour a zipped");
const poured = await until(async () => /Order 1182/.test(await boxText("page")));
const shownText = await boxText("page");
check("stages: a zipped order passes through three origins and comes out readable with the card hidden", !!poured && /•••• •••• •••• 9012/.test(shownText) && !/4929/.test(shownText) && /bytes in/.test(await frameText("unzip")) && /text in/.test(await frameText("redact")), flat(shownText));

await open("frozen", "built-relay");
await click("Connect the decoder"); await wait(1200);
await click("Freeze this page");
const relay = await until(async () => (await boxText("page")).match(/I ticked (\d+) times, the renderer painted (\d+) frames/), 12000);
check("relay: frames go from worker to worker while the page is frozen", !!relay && Number(relay[1]) <= 2 && Number(relay[2]) >= 40, relay ? relay[0] : "");

await open("halves", "built-roles");
await click("Give out the two ends"); await click("Sensor: report"); await click("Sensor: try to read"); await click("Dashboard: try to write"); await wait(900);
check("roles: the sensor writes and cannot read, the dashboard reads and cannot write", /reading 1: \d+\.\d°/.test(await frameText("dashboard")) && /I cannot write/.test(await frameText("dashboard")) && /I cannot read/.test(await frameText("sensor")) && /WritableStream/.test(await frameText("sensor")), flat(await frameText("dashboard")));

await open("lend", "built-delegate");
await click("Sign in"); await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Hand the session" }).isDisabled()));
await click("Hand the session"); await click("Page: try to use"); 
check("delegate: the worker uses the session and the page's port has gone", !!(await until(async () => /balance is 2\d\d, fetched without the page/.test(await boxText("worker")))) && !!(await until(async () => /heard nothing\. It moved/.test(await boxText("page")))), flat(await boxText("worker")));

await open("signer", "built-quota");
await click("Give each app"); await click("Weather app"); await wait(500); await click("Garden app"); await wait(500); await click("Garden app"); await wait(500); await click("Weather app"); await wait(800);
const keeper = await frameText("keeper");
check("quota: each app has its own allowance on its own port", /garden: refused, allowance used/.test(keeper) && /weather: signed "GET \/forecast\?n=2", 1 left/.test(keeper) && /refused: allowance used/.test(await frameText("garden")) && /signed: [0-9a-f]{12}/.test(await frameText("weather")), flat(keeper));

await open("tearoff", "built-pip");
await click("Float the meter"); await wait(900);
const pipSaid = await boxText("page");
check("pip: the meter floats, or the page says plainly why not", /The port did not move|has no Document Picture-in-Picture|would not open it/.test(pipSaid), flat(pipSaid));

await open("tearoff", "built-upgrade");
await click("Connect version 1"); await wait(1500); await click("Load version 2");
const v2 = await until(async () => { const t = await frameText("v2").catch(() => ""); return /message \d+\. Missed so far: 0/.test(t) && /took over a live port/.test(t) && t; });
await wait(1000);
check("upgrade: version 2 carries on from version 1's port with nothing missed", !!v2 && !/Missed so far: [1-9]/.test(await frameText("v2")) && (await page.locator(`${at} .box[data-name="v1"] iframe`).count()) === 0, flat(v2 || ""));

await open("reload", "built-shop");
const site = () => page.locator(`${at} .box[data-name="site"] iframe`).contentFrame();
await until(async () => Number(await site().locator("#n").innerText()) >= 2);
await click("Go to the next page"); await until(async () => (await site().locator("#title").innerText()) === "Basket"); await wait(900);
await click("Go to the next page"); await until(async () => (await site().locator("#title").innerText()) === "Account"); await wait(1200);
check("shop: the port survives two real navigations with no update missed", (await site().locator("#title").innerText()) === "Account" && (await site().locator("#gaps").innerText()) === "0" && Number(await site().locator("#n").innerText()) >= 6 && /collected the port/.test(await site().locator("#log").innerText()) && /2 page changes\. On Account/.test(await boxText("bank")), flat(await boxText("bank")));

await open("tabserver", "built-files");
await click("Write three files"); await until(async () => !(await page.locator(`${at} .controls button`, { hasText: "Load the site" }).isDisabled()));
await click("Load the site");
const filesFrame = () => page.locator(`${at} .box[data-name="served"] iframe`).contentFrame();
const servedOk = await until(async () => /Served from a file system/.test(await filesFrame().locator("body").innerText()) && /served flower\.svg/.test(await boxText("page")) && /served style\.css/.test(await boxText("page")));
const bg1 = await filesFrame().locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);
await click("Rewrite the stylesheet"); await wait(1500);
const bg2 = await filesFrame().locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);
check("files: a page, stylesheet and picture are served from the private file system, and a rewrite shows", !!servedOk && bg1 !== bg2, `${bg1} then ${bg2}`);

await open("tabserver", "built-notes");
await click("Open a reader");
const notesFrame = () => page.locator(`${at} .box[data-name="served"] iframe`).contentFrame();
const firstFetch = await until(async () => /fetch 1: 200, 1 notes/.test(await notesFrame().locator("body").innerText()));
await click("Add a note"); await click("Reader: fetch again");
check("notes: another page fetches JSON that only this tab holds", !!firstFetch && !!(await until(async () => /fetch 2: 200, 2 notes/.test(await notesFrame().locator("body").innerText()))) && /Order brown paper/.test(await notesFrame().locator("body").innerText()), flat(await boxText("page")));

await open("filter", "built-recorder");
await click("Attach the kitchen"); await click("Send an order"); await click("Send an order"); await wait(600); await click("Recorder: say"); await wait(600);
check("recorder: both branches carry every order", /cook: 1 peony wreath/.test(await frameText("kitchen")) && /I hold 2 orders, \d+ bytes/.test(await frameText("recorder")), flat(await frameText("recorder")));

const enabled = (label) => until(async () => !(await page.locator(`${at} .controls button`, { hasText: label }).isDisabled()), 15000);
const servedText = () => page.locator(`${at} .box[data-name="served"] iframe`).contentFrame().locator("body").innerText();

await open("far", "built-agent");
await click("Open a line"); await click("Use a stand-in"); await enabled("call addTulips");
await click("call addTulips"); await wait(700); await click("call readBasket"); await wait(700); await click("call deleteAccount");
check("agent: the far side calls this browser's tools, and an unoffered name is refused", !!(await until(async () => /deleteAccount: refused, no such tool/.test(await frameText("far")))) && /readBasket: 1 bunches of tulips/.test(await frameText("far")) && /Basket: 1 bunches/.test((await boxText("page")).replace(/\n/g, " ")), flat(await frameText("far")));

await open("mounted", "built-plugins");
await click("Install the calendar"); await until(async () => /Calendar/.test(await servedText()));
await click("Open the calendar"); const cal = await until(async () => /Thursday: tulip delivery/.test(await servedText()) && /asked for icon\.svg/.test(await frameText("Calendar")));
await click("Install the invoices"); await wait(600); await click("Open the invoices");
check("plugins: each plug-in answers for its own path, page and picture", !!cal && !!(await until(async () => /Invoice 31: paid/.test(await servedText()) && /asked for icon\.svg/.test(await frameText("Invoices")))) && !/invoices/i.test((await frameText("Calendar")).replace("Calendar plug-in", "")), flat(await frameText("Invoices")));

await open("mounted", "built-preview");
await click("Mount the provider"); await enabled("Open the preview"); await click("Open the preview");
const draft1 = await until(async () => /Draft 1\. Tulips 4\.50/.test(await servedText()));
await click("Provider: save"); await click("Reload the preview");
check("preview: the draft is served from the provider, and a new version shows on reload", !!draft1 && !!(await until(async () => /Draft 2/.test(await servedText()))) && /sent draft\.css, version 2/.test(await frameText("provider")), flat(await frameText("provider")));

await open("socket", "built-feed");
const feedTab = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
const hubText = async () => (await boxText("worker")).replace(/\n/g, " ");
const live = await until(async () => /\d+ prices received/.test(await feedTab("tab1")) && /\d+ prices received/.test(await feedTab("tab2")) && /Connections it has made: 1 .*Connected now: yes .*Tabs it feeds: 2/.test(await hubText()));
await click("Drop the connection");
const dropped = await until(async () => /Trying again in/.test(await hubText()) || /Connections it has made: 2/.test(await hubText()), 5000);
const got = Number((await feedTab("tab2")).match(/(\d+) prices/)?.[1]);
const back = await until(async () => /Connections it has made: 2 .*Connected now: yes/.test(await hubText()) && Number((await feedTab("tab2")).match(/(\d+) prices/)?.[1]) > got, 12000);
check("feed: two tabs share one subscription, and the worker alone reconnects it", !!live && !!dropped && !!back && /WebSockets opened by this tab: 0/.test(await feedTab("tab1")), flat(await hubText()));

await open("audio", "built-pcm");
await click("Start the decoder"); await enabled("Freeze"); await wait(600); await click("Freeze");
const pcm = await until(async () => (await boxText("page")).match(/I ticked (\d+) times, the worker delivered (\d+) blocks, and the sound had (\d+) gaps/), 12000);
check("pcm: the worker keeps the audio thread fed while the page is frozen", !!pcm && Number(pcm[1]) <= 2 && Number(pcm[2]) >= 20 && Number(pcm[3]) === 0, pcm ? pcm[0] : flat(await boxText("page")));
await click("Stop the sound");

await open("audio", "built-meter");
await click("Start the tone"); await enabled("Freeze"); await wait(600); await click("Freeze");
const meter = await until(async () => (await boxText("page")).match(/I ticked (\d+) times, the worker drew (\d+) readings/), 12000);
check("meter: readings go from the audio thread to a worker while the page is frozen", !!meter && Number(meter[1]) <= 2 && Number(meter[2]) >= 40, meter ? meter[0] : flat(await boxText("page")));
await click("Stop the sound");

// The router: windows that know only their own name and the worker in the middle.
const win = (name) => page.locator(`${at} .box[data-name="${name}"] iframe`).contentFrame().locator("body").innerText();
at = "#demo"; await page.goto(`${root}/patterns/router/?play=0`); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await wait(900);
await click("Register the three windows"); await enabled("Orders: send to the kitchen");
await click("Orders: send to the kitchen"); await click("Kitchen: send to the driver"); await click("Orders: send to the florist");
check("router: a shared worker passes messages on by name, and says when a name is unknown", !!(await until(async () => /from orders: message 1/.test(await win("kitchen")) && /from kitchen: message 1/.test(await win("driver")) && /undelivered: nobody is called florist/.test(await win("orders")))) && /Passed on: 2\. Undelivered: 1/.test((await boxText("router")).replace(/\n/g, " ")), flat(await boxText("router")));
await click("Close the kitchen"); await until(async () => /Knows: (orders, driver|driver, orders)/.test((await boxText("router")).replace(/\n/g, " ")), 6000); await click("Orders: send to the kitchen");
check("router: a closed window leaves the table", !!(await until(async () => /undelivered: nobody is called kitchen/.test(await win("orders")))), flat(await boxText("router")));
check("router: the page has a diagram of the data flow", (await page.locator("#how figure.flow svg").count()) === 1 && (await page.locator("#how figure.flow svg").evaluate((el) => el.getBoundingClientRect().width)) > 250);

await open("router", "built-swroute");
await click("Register the three windows"); await enabled("Orders: send to the kitchen");
await click("Orders: send to the kitchen"); const swFirst = await until(async () => /from orders: message 1/.test(await win("kitchen")));
await click("Make the Service Worker forget"); await until(async () => /Knows: nobody/.test((await boxText("router")).replace(/\n/g, " ")));
await click("Kitchen: send to the driver");
check("router: a service worker that has forgotten asks who is here, and still delivers", !!swFirst && !!(await until(async () => /from kitchen: message 1/.test(await win("driver")))) && /asked who is here: [1-9]/.test((await boxText("router")).replace(/\n/g, " ")), flat(await boxText("router")));

// The guide carries the same demos, running inside each section.
await page.goto(root + "/guide/");
const cards = await page.locator(".live").count();
at = "#live-built-cap";
await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .fwd`, { timeout: 15000 }); await page.locator(`${at} .stage-el`).scrollIntoViewIfNeeded(); await wait(800);
for (let i = 0; i < 4; i++) { await page.locator(`${at} .fwd`).click(); await wait(1300); }
check("guide: every section has running demos, and they step with Next", cards >= 64 && /4 of 4/.test(await page.locator(`${at} .caption`).innerText()) && /refused: over the limit/.test(await frameText("shop")), `${cards} demos`);
const guideDemo = async (id) => { at = "#live-" + id; await page.locator(at).scrollIntoViewIfNeeded(); await page.waitForSelector(`${at} .controls button`, { timeout: 15000 }); await page.locator(`${at} .stepper .caption`).waitFor(); if (/\?play=0/.test(page.url()) === false) await page.evaluate((sel) => document.querySelector(sel + " .stage-el")?.scrollIntoView({ block: "center" }), at); await wait(600); };
await page.goto(root + "/guide/?play=0");
await guideDemo("bite-start");
await click("Send a message"); await click("Send a message"); await wait(500);
const silent = !/received/.test(await frameText("frame"));
await click("Frame: call port.start()"); await wait(500);
check("bites: a port without start() holds its messages, and start() delivers them", silent && /received: message 2/.test(await frameText("frame")) && /received: message 1/.test(await frameText("frame")), flat(await frameText("frame")));
await guideDemo("bite-unreadable");
await click("Send some text"); await until(async () => /text: acknowledged/.test(await boxText("page")));
await click("Send a module, carelessly"); await wait(900);
const quiet = !/messageerror/.test(await boxText("worker"));
await click("Send a module, with the habits");
check("bites: an unreadable message is silent by default, and reported with the habits", quiet && !!(await until(async () => /failed, and I know it: the receiver could not rebuild it/.test(await boxText("page")))) && /messageerror/.test(await boxText("worker")), flat(await boxText("page")));
await guideDemo("bite-gone");
await click("Start a heartbeat"); await until(async () => /pong 1/.test(await boxText("page"))); await click("Remove the service");
check("bites: a heartbeat notices the other end has gone", !!(await until(async () => /Treating the other end as gone/.test(await boxText("page")), 6000)), flat(await boxText("page")));
await guideDemo("bite-lost");
await click("mention one"); await wait(500); await click("mention both"); await wait(500);
check("bites: a buffer moved without being mentioned arrives nowhere", /received: a \(64 KB\) and b \(64 KB\)/.test(await frameText("frame")) && /b 0 bytes\. b is nowhere/.test(await boxText("page")) && (await frameText("frame")).split("received: a (64 KB)").length === 3, flat(await frameText("frame")));
const sections = await page.evaluate(() => [...document.querySelectorAll("main section")].filter((s) => !s.querySelector(".live")).map((s) => s.id));
check("guide: only the list of open questions has no demo", sections.join() === "open", sections.join());

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
