// For each pattern: the code on its page, being used, and a real case for it.
//
// A pattern's `code` shows the part that is new. It often leaves out the other
// side: who calls it, when, and what happens next. That is here. `code` is
// HTML for a <pre>, written the way the patterns' own code is. `when` is one
// paragraph that starts "A real case."
export const usage = {
  attenuate: {
    code: `<span class="c">// a document editor, and a word-count plug-in from another company in a frame</span>
const grant = readOnly(counter);
plugin.contentWindow.postMessage({ counter: grant.port }, pluginOrigin, [grant.port]);

<span class="c">// the plug-in can read for as long as the editor lets it</span>
port.postMessage("read");
port.onmessage = (e) =&gt; show(e.data);

<span class="c">// the person turns the plug-in off, or signs out</span>
offButton.onclick = () =&gt; grant.revoke();

<span class="c">// The plug-in still holds its port, and nothing answers it now.</span>
<span class="c">// It is told nothing, so it needs a timeout of its own to notice.</span>`,
    when: "A real case. A document editor lets a plug-in from another company read the document, to count words. The editor gives the plug-in a read-only port when the person turns the plug-in on. When the person turns it off, signs out, or opens a document marked private, the editor calls <code>revoke()</code>. The editor does not have to find the plug-in or trust it to stop. Each plug-in has a port of its own, so turning one off leaves the others working.",
  },

  hello: {
    code: `<span class="c">// inside the frame: a help chat from a support company, on a shop's order page</span>
addEventListener("message", (event) =&gt; {
  <span class="c">// check who sent it once, here. Messages on the port need no check.</span>
  if (event.origin !== shopOrigin || event.data !== "here") return;
  const port = event.ports[0];          <span class="c">// this is port2. It belongs to the frame now.</span>
  <span class="c">// the page posted "ping" before this ran. It waited in the port.</span>
  port.onmessage = (e) =&gt; {
    if (e.data === "ping") port.postMessage("pong");
    else showOrder(e.data.order);
  };
});

<span class="c">// back in the shop's page, when the person opens an order</span>
port1.postMessage({ order: "A-1041" });`,
    when: "A real case. A shop puts a help chat from a support company on its order page, in a frame. When the frame has loaded, the shop's page makes a channel and posts one end into it. The chat checks the sender's origin once, when the port arrives, and keeps the port. After that the shop sends the order the person is looking at down the port, and the chat answers on it. A third-party script in the shop's page that listens for window <code>message</code> events sees none of these messages.",
  },

  introduce: {
    code: `<span class="c">// a print shop wants the person's photos. When the person presses Choose photos</span>
<span class="c">// it opens a picker window, and that is what lets the shop post to the picker.</span>
const picker = window.open(pickerUrl, "", "popup");
const line = new MessageChannel();
<span class="c">// once the picker says it is ready</span>
picker.postMessage("line", pickerOrigin, [line.port2]);  <span class="c">// the picker keeps this as toLeft</span>

<span class="c">// In the picker, the person chooses a photo store. The picker opens it in a</span>
<span class="c">// window, posts it a port in the same way, and keeps the other end as toRight.</span>
<span class="c">// Then the picker runs the code above and closes.</span>

<span class="c">// the print shop hears on its line to the picker</span>
line.port1.onmessage = (e) =&gt; {
  const store = e.ports[0];             <span class="c">// port1 of the new channel</span>
  line.port1.close();                   <span class="c">// the picker is not needed again</span>
  show("Connected to " + e.data.meet);
  store.onmessage = (m) =&gt; addToOrder(m.data.photo);
  store.postMessage({ want: "photos" });
};`,
    when: "A real case. A print shop needs photos that the person keeps with a photo storage site. The shop does not know every storage site, so it opens a picker window, and the picker opens the storage site that the person chooses. The picker was opened by the shop and it opened the storage site, so it can hold a port to each. It makes a new channel, sends one end to the shop and one to the storage site, and closes. The shop then asks the storage site for photos directly, and the picker sees none of it.",
  },

  reply: {
    code: `<span class="c">// a writing app. The service is a worker that checks spelling.</span>
const service = new Worker("/spelling.js");

<span class="c">// two paragraphs are checked at the same time</span>
const [intro, chapter] = await Promise.all([
  ask(service, { text: introText }),
  ask(service, { text: chapterText }),
]);
underline(introBox, intro);
underline(chapterBox, chapter);

<span class="c">// in spelling.js: answer on the port that came with the question</span>
onmessage = async (e) =&gt; {
  const reply = e.ports[0];
  reply.postMessage(await mistakesIn(e.data.text));
};

<span class="c">// The short paragraph may be answered first. Each answer still reaches</span>
<span class="c">// the ask() that sent its port. If the worker never answers, ask() waits</span>
<span class="c">// for ever, so a real ask() also needs a timeout that closes port1.</span>`,
    when: "A real case. A writing app checks spelling in a worker. The page sends each paragraph as a question of its own while the person edits, so several questions are open at once. Each question carries its own reply port, so the result for a long chapter cannot land on the short introduction, whichever the worker finishes first. The worker keeps no list of who asked. It answers on the port that came with the question and forgets it.",
  },

  exchange: {
    code: `<span class="c">// in every tab of a notes app</span>
const worker = new SharedWorker("/exchange.js");
const others = new Map();
worker.port.onmessage = ({ data, ports: [direct] }) =&gt; {
  others.set(data.meet, direct);          <span class="c">// one port for each other tab</span>
  direct.onmessage = (e) =&gt; showEdit(e.data);
};

<span class="c">// the person types in this tab. Each other tab gets the edit on its own port.</span>
<span class="c">// The worker does not see it.</span>
editor.oninput = () =&gt; {
  for (const direct of others.values()) direct.postMessage({ note: noteId, text: editor.value });
};

<span class="c">// A tab that has closed stays in the map. Posting to it does nothing</span>
<span class="c">// and raises no error.</span>`,
    when: "A real case. A notes app is open in three tabs, and the person types in one of them. Each tab connects to the same SharedWorker when it loads, and the worker hands it a direct port to every tab that is already open. The typing tab posts each edit down those ports, so the other tabs show it without asking the server, and the worker carries none of it. A tab can also post to one other tab alone, for example to ask it for the newest draft, where a <code>BroadcastChannel</code> would send that to every tab. This needs a browser that has SharedWorker.",
  },

  stream: {
    code: `<span class="c">// a spreadsheet app sends a large sheet to a chart tool, a frame from another company</span>
let next = 0;
const nextChunk = () =&gt; sheet.rows.slice(next, (next += 500));
const stream = new ReadableStream({
  pull(controller) {                    <span class="c">// runs when the reader has room for more</span>
    if (next &gt;= sheet.rows.length) return controller.close();
    controller.enqueue(nextChunk());
  },
});
try { port.postMessage({ stream }, [stream]); }
catch { tellPerson("This browser cannot send a stream."); }

<span class="c">// the chart tool</span>
async function use(rows) { await chart.add(rows); }
port.onmessage = async ({ data }) =&gt; {
  for await (const chunk of data.stream) await use(chunk);  <span class="c">// a slow use() slows pull()</span>
  chart.finish();                       <span class="c">// reached after controller.close()</span>
};`,
    when: "A real case. A spreadsheet app lets the person send a sheet to a chart tool from another company, which runs in a frame. The sheet has a million rows, so the app hands the frame a stream and cuts the next 500 rows each time the stream asks for more. The frame draws rows as they arrive, and when it falls behind, the app is asked less often. When the rows run out the app closes the stream and the frame's loop ends. This works in Chrome and Firefox today.",
  },

  canvas: {
    code: `<span class="c">// a shoe shop's product page. The 3D viewer is a frame from another company.</span>
const channel = new MessageChannel();
const port = channel.port1;
viewer.contentWindow.postMessage("paint", viewerOrigin, [channel.port2]);

<span class="c">// the viewer cannot measure the shop's canvas, so the page sends width and height</span>
port.postMessage({ width: canvas.width, height: canvas.height });

<span class="c">// the person picks red. The viewer's paint() uses it from the next frame.</span>
redSwatch.onclick = () =&gt; port.postMessage({ colour: "red" });

<span class="c">// the person leaves the product. A closed port tells the viewer nothing,</span>
<span class="c">// so the page asks it to stop, and frees frames that are already on the way.</span>
closeButton.onclick = () =&gt; {
  port.postMessage({ stop: true });
  port.onmessage = ({ data }) =&gt; data.frame.close();
};`,
    when: "A real case. A shoe shop shows a 3D view of each shoe, drawn by a viewer from another company. The viewer runs in a frame on its own origin and sends each finished picture down a port, and the shop shows it in a canvas inside its own product layout. The shop sends the canvas size and the colour the person picks down the same port. The viewer's code never runs in the shop's page, so it cannot read the basket or the person's details. When the person leaves the product, the shop asks the viewer to stop and closes any pictures that still arrive.",
  },

  functions: {
    code: `<span class="c">// a photo site. A resizing tool from another company runs in a frame.</span>
<span class="c">// The site lends it a function that moves the site's own progress bar.</span>
const onProgress = (done, total) =&gt; { bar.max = total; bar.value = done; };
const grant = lend(onProgress);
tool.contentWindow.postMessage({ resize: photos }, toolOrigin, [grant.port]);

<span class="c">// in the tool's frame</span>
addEventListener("message", async (event) =&gt; {
  if (event.origin !== photoSiteOrigin) return;
  const onProgress = borrow(event.ports[0]);   <span class="c">// a function again</span>
  let done = 0;
  for (const photo of event.data.resize) {
    await shrink(photo);
    onProgress(++done, event.data.resize.length);  <span class="c">// runs in the photo site's page</span>
  }
});

<span class="c">// the person cancels: the tool's later calls do nothing, and it is told nothing</span>
cancelButton.onclick = () =&gt; grant.revoke();`,
    when: "A real case. A photo site uses a resizing tool from another company, which runs in a frame on its own origin. The site wants its own progress bar to move while the tool works, so it lends the tool an <code>onProgress</code> function. The tool calls it after each photo, and the call runs in the site's page, where the bar is. The tool cannot read the function or reach the bar. When the person cancels, the site calls <code>revoke()</code>, which closes its end of the channel, and the tool's later calls do nothing.",
  },

  zerocopy: {
    code: `<span class="c">// a photo editor. A filter plug-in from another company runs in a frame.</span>
const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
const buffer = image.data.buffer;       <span class="c">// 48 MB for a picture of 4000 by 3000</span>
port.postMessage(buffer, [buffer]);
<span class="c">// buffer.byteLength is 0 now, and so is image.data.length.</span>
<span class="c">// The editor holds no pixels until the plug-in sends them back.</span>
<span class="c">// With port.postMessage(buffer) both sides would hold 48 MB.</span>

<span class="c">// the plug-in: change the bytes, then transfer the same buffer back</span>
port.onmessage = ({ data: buffer }) =&gt; {
  sepia(new Uint8ClampedArray(buffer));
  port.postMessage(buffer, [buffer]);
};

<span class="c">// the editor: the old view stays empty, so make a new one</span>
port.onmessage = ({ data: buffer }) =&gt;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), canvas.width), 0, 0);`,
    when: "A real case. A photo editor lets filter plug-ins from other companies change the picture, each in a frame of its own. A picture of 4000 by 3000 pixels is 48 MB. The editor transfers the buffer to the plug-in, the plug-in changes the bytes and transfers the same buffer back. Only one side holds the buffer at a time, where a plain <code>postMessage</code> would leave 48 MB on each side. While the buffer is away the editor has zero bytes, so it waits for the buffer to return before it draws or lets the person paint.",
  },

  tearoff: {
    code: `<span class="c">// a share dealing page, with a live price meter the person moves to a second screen</span>
<span class="c">// /meter.html, in the new window: say it is ready, then take the port</span>
let port = null;
opener.postMessage("ready", location.origin);
addEventListener("message", (event) =&gt; {
  if (event.origin !== location.origin || !event.data.feed) return;
  port = event.data.feed;
  port.onmessage = (e) =&gt; showPrice(e.data);        <span class="c">// the next price arrives here</span>
});
<span class="c">// the person closes the new window: post the port back first</span>
addEventListener("pagehide", () =&gt; { if (port) opener.postMessage({ back: true }, location.origin, [port]); });

<span class="c">// the dealing page: send the port on "ready", and take it back later</span>
addEventListener("message", (event) =&gt; {
  if (event.source !== win || event.origin !== location.origin) return;
  if (event.data === "ready") win.postMessage({ feed: port }, location.origin, [port]);
  if (event.data.back) { port = event.ports[0]; port.onmessage = (e) =&gt; showPrice(e.data); }
});
<span class="c">// If the new window is killed, pagehide does not run and the port is lost.</span>
<span class="c">// The page can watch win.closed, and ask the feed for a new port.</span>`,
    when: "A real case. A share dealing page shows a live price meter. The prices arrive on a port from a frame run by the market data company, which the person signed in to once. The person wants the meter on a second screen while they fill in an order. The page opens a small window and posts the port to it, so the meter carries on from the next price with no new sign-in and no reconnect. When the person closes the small window it posts the port back, and the meter in the page starts again.",
  },

  tabserver: {
    code: `<span class="c">// a site editor in the browser. The files being edited live in this tab, in a Map called files</span>
<span class="c">// the editor tab: offer() gives the worker a port, and answers what comes up it</span>
const offer = () =&gt; {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) =&gt; {              <span class="c">// one request, and its reply port</span>
    const path = new URL(event.data.url).pathname;
    const body = files.get(path) || "No such file in the editor";
    event.ports[0].postMessage({ body, headers: { "content-type": typeOf(path) } });
  };
  registration.active.postMessage({ serve: true }, [channel.port2]);
};
offer();

<span class="c">// the Service Worker: keep that port as tabPort</span>
onmessage = (event) =&gt; { if (event.data.serve) tabPort = event.ports[0]; };

<span class="c">// the person presses Preview. This is a real navigation, answered by the editor tab</span>
previewButton.onclick = () =&gt; window.open("/preview/index.html");

<span class="c">// The browser stops an idle Service Worker, and tabPort goes with it. When the worker</span>
<span class="c">// wakes it posts "need-port" to its open tabs, and the editor hands over a new port.</span>
navigator.serviceWorker.onmessage = (event) =&gt; { if (event.data === "need-port") offer(); };`,
    when: "A real case. A site editor runs in the browser and keeps the files being edited in memory, in one tab. The person presses Preview, and a second tab opens at <code>/preview/index.html</code>. The Service Worker holds no files, so it sends each URL up <code>tabPort</code> and the editor tab answers with the text as it stands, saved or not. A style sheet or a link in the preview is one more request, answered the same way. The moment to plan for is a quiet spell: the browser stops the worker, <code>tabPort</code> is lost, and the editor has to hand over a new port before the next request can be answered.",
  },

  "stream-intro": {
    code: `<span class="c">// a photo editor, a "Save to" chooser window it opened, and the storage site the person picks</span>
<span class="c">// the chooser: make a channel, give one end to each side, keep neither</span>
const { port1, port2 } = new MessageChannel();
toEditor.postMessage({}, [port1]);
toStorage.postMessage({}, [port2]);

<span class="c">// the editor: introducedPort() waits for that port to arrive from the chooser</span>
const introducedPort = () =&gt; new Promise((resolve) =&gt; { toMiddle.onmessage = (e) =&gt; resolve(e.ports[0]); });
const direct = await introducedPort();
const stream = exportPhoto();                 <span class="c">// a ReadableStream of bytes</span>
direct.postMessage({ stream }, [stream]);

<span class="c">// the storage site: a port arrives from the chooser, then the stream arrives on that port</span>
toMiddle.onmessage = (e) =&gt; {
  e.ports[0].onmessage = async ({ data }) =&gt; {
    const reader = data.stream.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; await save(value); }
  };
};

<span class="c">// The person closes the chooser. The export carries on, because no chunk passes through the chooser.</span>
<span class="c">// Sent with toMiddle.postMessage, the same stream would stall here, with no error and no end.</span>`,
    when: "A real case. A photo editor exports a large file to a storage site that the person picks in a chooser window the editor opened. The chooser opened the storage site's upload page, so it is the only one with a line to both. If the export stream is passed through the chooser, the upload stalls when the person closes the chooser, and neither side gets an error. So the chooser makes a channel and posts one end to each side, and the editor sends the stream down that port. The person can then close the chooser and the upload carries on.",
  },

  pipeline: {
    code: `<span class="c">// a recorded meeting page, a caption styler from a second company, a player from a third</span>
const toStyler = new MessageChannel(), between = new MessageChannel();
styler.contentWindow.postMessage({}, stylerOrigin, [toStyler.port2, between.port1]);   <span class="c">// port and toReader</span>
player.contentWindow.postMessage({}, playerOrigin, [between.port2]);
<span class="c">// the page: a stream that makes a line only when it is asked for one</span>
const readable = new ReadableStream({ pull(c) { c.enqueue(nextLine()); } }, { highWaterMark: 0 });
toStyler.port1.postMessage({ readable }, [readable]);

<span class="c">// the styler: shout is its transform</span>
const shout = (line, controller) =&gt; controller.enqueue(line.toUpperCase());

<span class="c">// the player: show one caption for two seconds, then read the next</span>
port.onmessage = async ({ data }) =&gt; {
  const reader = data.readable.getReader();
  for (;;) {
    if (paused) await resumed();                <span class="c">// the person pressed pause</span>
    const { value, done } = await reader.read();
    if (done) return;
    await showFor(value, 2000);
  }
};
<span class="c">// While it is paused nothing is read. A few lines later pull() stops being called in the page.</span>`,
    when: "A real case. A page plays a recorded meeting and holds the transcript. A frame from a second company styles each line as a caption, and a player frame from a third company shows one caption at a time. The page gives the styler a port to the player, so styled lines go to the player and do not come back through the page. When the person pauses the player it stops reading, and a few lines later the page stops being asked for more. No stage sends a pause message to another, and only a few lines are in flight at any time.",
  },

  reload: {
    code: `<span class="c">// a notes app that the person has connected to their calendar, open in another tab</span>
<span class="c">// /bank.js: hold a port under a key until a page asks for it</span>
const kept = new Map();
onconnect = ({ ports: [client] }) =&gt; {
  client.onmessage = ({ data, ports }) =&gt; {
    if (data.deposit) return kept.set(data.deposit, ports[0]);
    const port = kept.get(data.withdraw);
    kept.delete(data.withdraw);
    client.postMessage({ found: !!port }, port ? [port] : []);
  };
};

<span class="c">// the notes app: a key that this tab keeps across a reload</span>
const key = sessionStorage.portKey || (sessionStorage.portKey = crypto.randomUUID());

<span class="c">// on load: take the port back, or ask the person to connect again if the bank has nothing</span>
const resume = (port) =&gt; { port.onmessage = (e) =&gt; showEvent(e.data); };
bank.port.onmessage = ({ data, ports }) =&gt; data.found ? resume(ports[0]) : connectAgain();

<span class="c">// What the calendar sent during the reload waited in the port, and arrives now in order.</span>
<span class="c">// The bank is empty on a first visit, and after a crash, when pagehide did not run.</span>
<span class="c">// A deposit can arrive after the withdraw, so a real bank waits a moment before it says no.</span>`,
    when: "A real case. A notes app is connected to a calendar that is open in another tab. The person made that connection by hand, through a chooser, and the port is all the notes app has of it. When the person presses reload, the page deposits the port as it goes and the new page withdraws it, so the person is not asked to connect a second time. If the bank comes back empty, as it does after a crash or where the worker did not live through the reload, the app asks the person to connect again.",
  },

  router: {
    code: `<span class="c">// one delivery business, one computer, three windows: orders, kitchen and driver</span>
<span class="c">// the kitchen window: it is told who sent each message, and answers by that name</span>
const { port } = new SharedWorker("/router-worker.js");
port.postMessage({ iam: "kitchen" });
port.onmessage = ({ data }) =&gt; {
  if (data.undelivered) return warn("No window called " + data.undelivered + " is open");
  show(data.from, data.text);
  port.postMessage({ to: data.from, text: "started" });
};
readyButton.onclick = () =&gt; port.postMessage({ to: "driver", text: "two tulip bunches, ready to go" });

<span class="c">// the router's table, and how it finds the sender's name</span>
const table = new Map();                      <span class="c">// name -&gt; port</span>
const nameOf = (port) =&gt; [...table].find(([, p]) =&gt; p === port)?.[0];

<span class="c">// Nobody has opened the driver window yet today, so "driver" is not in the table.</span>
<span class="c">// The kitchen gets { undelivered: "driver" } back and shows the warning. The message is not kept.</span>`,
    when: "A real case. A small delivery business runs one web app on one computer, in three windows on three screens: orders at the counter, the kitchen's list, and the driver's list by the door. The windows are opened and closed through the day in any order, and none of them opened another, so none has a handle to another. Each one tells the router its name and addresses the others by name. The kitchen answers the orders window using the <code>from</code> that the router filled in. The moment that matters is a message to a name nobody holds: the router sends <code>undelivered</code> back, and the kitchen can tell its staff that the driver's window is not open.",
  },

  frozen: {
    code: `<span class="c">// a live prices page: workerA parses what a socket sends, workerB draws the chart</span>
const workerA = new Worker("/parse.js"), workerB = new Worker("/draw.js");
const surface = chart.transferControlToOffscreen();
workerB.postMessage({ surface }, [surface]);       <span class="c">// then the channel: port1 to workerA, port2 to workerB</span>

<span class="c">// /parse.js, workerA: port1 arrives here. Parsed prices go straight to the other worker</span>
const socket = new WebSocket("wss://prices.example/live");
onmessage = ({ ports: [toDraw] }) =&gt; { socket.onmessage = (e) =&gt; toDraw.postMessage(parse(e.data)); };

<span class="c">// /draw.js, workerB: the canvas arrives first, then port2</span>
let ctx = null;
onmessage = ({ data, ports: [fromParse] }) =&gt; {
  if (data.surface) ctx = data.surface.getContext("2d");
  if (fromParse) fromParse.onmessage = (e) =&gt; draw(ctx, e.data);
};

<span class="c">// the page: the person sorts a table of 50,000 rows, and the main thread is busy</span>
rows.sort(byPrice);
<span class="c">// The table does not respond until the sort ends. The chart keeps moving all the while.</span>`,
    when: "A real case. A prices page has a long table and a live chart. One worker holds the socket and parses what arrives, and a second worker draws the chart on a canvas the page handed it. The page introduces the two workers once and keeps no port. When the person sorts the table, the page's thread is busy and the page does not respond, but parsed prices still go from one worker to the other and the chart still moves. If the prices went through the page, the chart would stop for as long as the sort took.",
  },

  filter: {
    code: `<span class="c">// a video call page, and a background blur plug-in from another company in a sandboxed frame</span>
<span class="c">// sendNext runs for each camera picture. source is that picture, and carry is what it travels as</span>
let carry = "VideoFrame", waiting = false;
const sendNext = async (timestamp) =&gt; {
  if (waiting) return;                          <span class="c">// one picture out at a time</span>
  waiting = true;
  if (carry === "VideoFrame") {
    const frame = new VideoFrame(source, { timestamp });
    port.postMessage({ frame }, [frame]);
  } else {
    const bitmap = await createImageBitmap(source);
    port.postMessage({ bitmap }, [bitmap]);
  }
};
port.onmessage = ({ data }) =&gt; {
  waiting = false;
  if (data.unreadable) { carry = "ImageBitmap"; return; }   <span class="c">// that picture is lost. Bitmaps from now on</span>
  const picture = data.frame || data.bitmap;
  output.drawImage(picture, 0, 0);              <span class="c">// the blurred picture, which the call sends out</span>
  picture.close();
};
<span class="c">// If the plug-in stops answering, waiting stays true and the picture stops. Use a timeout to notice.</span>`,
    when: "A real case. A video call page offers background blur as a plug-in made by another company. The plug-in runs in a sandboxed frame, so it has no camera and cannot read the page. The page hands it one camera picture at a time down a port, and draws what comes back on the canvas that the call sends out. In Chrome 159 the first picture, a <code>VideoFrame</code>, arrives unreadable in that frame, and the plug-in answers <code>{ unreadable: true }</code>. The page then sends each picture as an <code>ImageBitmap</code>, and the blur works from the next picture on.",
  },

  signer: {
    code: `<span class="c">// a company's purchasing page, its key vault in one frame, a florist's ordering widget in another</span>
<span class="c">// the vault: how it signs, and how it gives out the public half of the key</span>
const ECDSA = { name: "ECDSA", namedCurve: "P-256" }, SHA = { name: "ECDSA", hash: "SHA-256" };
const sign = (key, text) =&gt; crypto.subtle.sign(SHA, key, new TextEncoder().encode(text));
port.postMessage({ publicKey: await crypto.subtle.exportKey("jwk", publicKey) });

<span class="c">// the page: pass answers down to the widget, and say why when it refuses</span>
vault.onmessage = ({ data }) =&gt; data.publicKey ? publish(data.publicKey) : lent.postMessage(data);
const refuse = (data) =&gt; lent.postMessage({ id: data.id, refused: "this port signs orders only, three times" });

<span class="c">// the florist's widget: ask, then get a signature or a refusal</span>
port.postMessage({ id: 1, text: "order: 2 dozen tulips" });
port.postMessage({ id: 2, text: "pay: 5000 to the florist" });
port.onmessage = ({ data }) =&gt; data.refused ? showError(data.refused) : sendOrder(data.id, data.signature);

<span class="c">// anyone with the public key can check an order. The florist has it as jwk</span>
const key = await crypto.subtle.importKey("jwk", jwk, ECDSA, false, ["verify"]);
const ok = await crypto.subtle.verify(SHA, key, signature, new TextEncoder().encode(text));

<span class="c">// the buyer signs out</span>
lent.close();
<span class="c">// The widget still holds its port. Nothing answers it now, and it is told nothing.</span>`,
    when: "A real case. A company buys flowers through a florist's ordering widget, which sits in a frame on the company's purchasing page. The florist only accepts orders signed with the company's key, and that key lives in a vault frame from the company's identity provider. The page holds the vault's signing port and lends the widget a weaker one: orders only, three uses. The widget gets signed orders it can send to the florist, and its attempt to sign a payment is refused by the page. When the buyer signs out the page closes the lent port, and the widget can sign nothing more.",
  },

  keycopy: {
    code: `<span class="c">// a flower company: sign-in pages on one origin, the shop (the florist) on another</span>
<span class="c">// the sign-in page: give the server the public half of the pair, so it can check signatures</span>
const spki = await crypto.subtle.exportKey("spki", publicKey);
await fetch("/devices", { method: "POST", body: spki });

<span class="c">// the florist: take a key from the sign-in origin and from nowhere else</span>
addEventListener("message", async (e) =&gt; {
  if (e.origin !== signInOrigin || !e.data?.key) return;
  await db.put(e.data.key, "theirs");
});

<span class="c">// the florist, a week later. The sign-in page is not open.</span>
const key = await db.get("theirs");
const signature = await crypto.subtle.sign(ECDSA, key, bytes);   <span class="c">// sent to the server with the order</span>

<span class="c">// the person signs out. The key cannot be taken back from the florist,</span>
<span class="c">// so the sign-in page asks the server to stop accepting its signatures.</span>
await fetch("/devices/this-one", { method: "DELETE" });`,
    when: "A real case. A flower company runs its sign-in pages on one origin and its shop on another. When a person signs in, the sign-in page makes a signing key, gives the public half to the company's server, and posts the private key to the shop. The shop keeps the key in its own IndexedDB and signs each order with it, so the sign-in page does not have to stay open. This is right only because one company owns both origins and the shop is meant to keep the key. The moment to plan for is sign-out: the sign-in page cannot remove the key from the shop's storage, so it asks the server to stop accepting that key's signatures.",
  },

  halves: {
    code: `<span class="c">// a town noticeboard page, with the library's frame and the florist's frame in it</span>
const readable = new ReadableStream({ start(c) { feed = c; } });
const keep = (notice) =&gt; feed.enqueue(notice);   <span class="c">// what a shop writes goes on the board</span>

<span class="c">// the library: show each notice. Its stream has no method that writes.</span>
const reader = readable.getReader();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;                               <span class="c">// the noticeboard closed the feed</span>
  show(value);
}

<span class="c">// the florist: send a notice in. It has nothing to read with.</span>
const writer = writable.getWriter();
try { await writer.write("Tulips, half price on Friday"); }
catch { show("The noticeboard has shut our box"); }

<span class="c">// the noticeboard: the florist sends too many adverts</span>
box.error(new Error("shut"));                    <span class="c">// the florist's next write fails</span>
<span class="c">// the noticeboard: the board is taken down</span>
feed.close();                                    <span class="c">// the library's next read says done</span>`,
    when: "A real case. A town noticeboard site embeds two other sites in frames. The library's frame shows the notices on a screen in its hall, so it is given the readable stream, which has no method that writes. The florist's frame sends notices in, so it is given a writable stream of its own and cannot read what other shops have sent. When the florist sends too many adverts, the noticeboard calls <code>box.error()</code> and the florist's next write fails, while the other shops' streams still work. When the board is taken down, the noticeboard closes the feed and the library's reader is told the stream has ended.",
  },

  roundtrip: {
    code: `<span class="c">// a support desk app, and a redaction service from another company in a frame</span>
<span class="c">// the service: redact is an ordinary transform function</span>
const redact = (line, controller) =&gt;
  controller.enqueue(line.replace(/[0-9][0-9 -]{6,}[0-9]/g, "[number]"));

<span class="c">// the support desk: take the two ends from the service's origin and from nowhere else</span>
addEventListener("message", (e) =&gt; {
  if (e.origin !== serviceOrigin || !e.data?.readable) return;
  const { readable, writable } = e.data;
  <span class="c">// chat is the WebSocket that carries what the customer types</span>
  const myLines = new ReadableStream({ start(c) { chat.onmessage = (m) =&gt; c.enqueue(m.data); } });
  const screen = new WritableStream({ write(line) { agentView.append(line); } });
  myLines.pipeThrough({ readable, writable }).pipeTo(screen);
});

<span class="c">// If the service's frame is removed, lines stop coming back and no error is raised.</span>
<span class="c">// The support desk times each line, and shows a fault when one is late.</span>`,
    when: "A real case. A support desk app shows agents what customers type in a chat, and customers sometimes type card numbers. The app pipes every line through a redaction service from another company, which runs in a frame on its own origin and hands over both ends of its transform. The service's code is never loaded into the app's page, and the service sees only the lines that are piped to it. The app does trust the service with those lines. If the service's frame is removed the pipe stops with no error, so the app keeps a timer and reports a fault when a line is late.",
  },

  lend: {
    code: `<span class="c">// a team chat app, and a poll plug-in from another company in a sandboxed frame</span>
<span class="c">// the frame's policy is default-src 'none', so the plug-in cannot open a connection itself</span>
const socket = new WebSocketStream(url);          <span class="c">// url holds the person's session token</span>
const { readable, writable } = await socket.opened;
widget.postMessage({ readable, writable }, "*", [readable, writable]);
<span class="c">// where WebSocketStream is missing, wrap a WebSocket in two streams and send those</span>

<span class="c">// the plug-in: send a vote, then show the results for as long as the line is open</span>
const writer = writable.getWriter(), reader = readable.getReader();
await writer.write(JSON.stringify({ vote: "Tuesday" }));
for (;;) {
  const { value, done } = await reader.read().catch(() =&gt; ({ done: true }));
  if (done) break;                                <span class="c">// the chat app closed the socket</span>
  show(JSON.parse(value));
}

<span class="c">// the chat app: the person removes the plug-in, or leaves the room</span>
removeButton.onclick = () =&gt; socket.close();
<span class="c">// The plug-in's read ends, and it has no other connection.</span>`,
    when: "A real case. A team chat app lets a room add a poll plug-in written by another company. The plug-in runs in a sandboxed frame whose content security policy is <code>default-src 'none'</code>, so it cannot open a connection of its own. The chat app opens the WebSocket to the room, with the person's session token in the address, and hands the plug-in the two streams. The plug-in sends votes and reads results, and it is never given the address or the token. When the person removes the plug-in or leaves the room, the chat app closes the socket and the plug-in's streams end.",
  },

  oneway: {
    code: `<span class="c">// a town's what's-on page, with the library's frame and the florist's frame in it</span>
<span class="c">// the library: publish each event on the port it was given</span>
addEventListener("message", (e) =&gt; {
  if (e.origin !== townOrigin || e.data?.cmd !== "feed") return;
  const send = e.ports[0];
  send.postMessage({ event: "Poetry reading", at: "19:00" });
});

<span class="c">// the florist: hear each event, and try to answer</span>
addEventListener("message", (e) =&gt; {
  if (e.origin !== townOrigin || e.data?.cmd !== "feed") return;
  const receive = e.ports[0];
  receive.onmessage = ({ data }) =&gt; offerFlowersFor(data.event);
  receive.postMessage({ advert: "10% off" });   <span class="c">// stops at the town's page. The library hears nothing.</span>
});

<span class="c">// the town's page: the florist's listing ends</span>
link.cut();
<span class="c">// The library's posts go nowhere now, and the florist hears nothing more.</span>
<span class="c">// Neither site is told, so each needs a timeout of its own to notice.</span>`,
    when: "A real case. A town's what's-on page embeds two other sites in frames. The library's frame publishes the day's events, and the florist's frame shows flowers to go with each one. The town wants the florist to hear the events, and wants nothing the florist posts into its port to reach the library's frame, which runs with the library's own storage. So the town's page keeps the middle of the link and gives each site one end. When the florist's listing ends, the town's page calls <code>cut()</code>, and neither site is told, so each needs a timeout to notice.",
  },

  far: {
    code: `<span class="c">// a venue's front desk laptop, and a steward's phone at the door</span>
<span class="c">// the laptop: code is six random characters, shown on screen as a QR code</span>
const line = far({ code, host: true, onPort(port) {
  counterFrame.postMessage({ cmd: "port" }, "*", [port]);   <span class="c">// the counter gets the port that stands for the phone</span>
} });

<span class="c">// the counter frame: it was given a port, and does not know a phone holds the other end</span>
addEventListener("message", (e) =&gt; {
  if (e.source !== parent || e.data?.cmd !== "port") return;
  const port = e.ports[0];
  port.onmessage = ({ data }) =&gt; { if (data.do === "add") count++; port.postMessage({ count }); };
});

<span class="c">// the phone, with the code from the QR link: one press for each person who comes in</span>
far({ code, onPort(port) {
  addButton.onclick = () =&gt; port.postMessage({ do: "add" });
  port.onmessage = ({ data }) =&gt; show(data.count);
}, onState(state) { if (state === "gone") show("The front desk hung up"); } });

<span class="c">// the laptop: the doors close</span>
line.close();`,
    when: "A real case. At a venue's door a steward counts people in on a phone, and the total shows on the front desk laptop. The laptop shows a pairing code as a QR code, the steward scans it, and the two devices connect directly. The laptop hands its port to the counter, which is a sandboxed frame that knows only that it was given a port. When the doors close the laptop calls <code>close()</code>, and the phone's <code>onState</code> reports <code>gone</code>. There is no relay, so this works only where the two devices can reach each other directly.",
  },

  mounted: {
    code: `<span class="c">// a wedding planner's site, and one florist it trusts</span>
<span class="c">// the florist's frame: answer each request that comes down the port</span>
addEventListener("message", (e) =&gt; {
  if (e.origin !== plannerOrigin || e.data?.cmd !== "serve") return;
  e.ports[0].onmessage = ({ data, ports }) =&gt; {
    const body = stockList(data.path);            <span class="c">// a ReadableStream the florist is still writing</span>
    ports[0].postMessage({ status: 200, headers: { "content-type": "text/plain" }, body }, [body]);
  };
});

<span class="c">// the planner's own pages: the florist's files have addresses on this origin</span>
const stock = await fetch("/mounted/florist/stock.txt");
picture.src = "/mounted/florist/tulip.svg";

<span class="c">// the Service Worker was stopped and lost its port. It asks, and the page sends a new one.</span>
<span class="c">// introduce() makes a new channel and posts its two ends, as above.</span>
navigator.serviceWorker.addEventListener("message", (e) =&gt; { if (e.data.needMount) introduce(); });

<span class="c">// the planner drops the florist</span>
reg.active.postMessage({ unmount: true });
<span class="c">// Requests under /mounted/florist/ now get a 503 from the worker.</span>`,
    when: "A real case. A wedding planner's site works with one florist and wants the florist's stock list and pictures inside its own pages. It mounts the florist's site at <code>/mounted/florist/</code>, and the florist's page, open in a frame, answers each request. The planner's pages load those files with an ordinary <code>fetch</code> or <code>img</code> from addresses on the planner's own origin, and the planner runs no proxy. What is mounted runs as the planner's origin, so the planner does this only with a florist it would let act in its name. When the planner drops the florist it tells the worker to unmount, and requests under that path get a 503.",
  },

  socket: {
    code: `<span class="c">// an issue tracker. A person has ten issues open in ten tabs.</span>
<span class="c">// each tab: ask about its own issue, and hold a lock under a name of its own while the tab lives</span>
port.postMessage({ say: "status of issue 4127" });
navigator.locks.request(lock, () =&gt; { port.postMessage({ lock }); return new Promise(() =&gt; {}); });

<span class="c">// the worker: every tab arrives here with a port of its own</span>
onconnect = (e) =&gt; {
  const port = e.ports[0];
  port.onmessage = ({ data }) =&gt; {
    <span class="c">// when the worker gets the tab's lock, the tab has gone. leave() drops its questions.</span>
    if (data.lock) return navigator.locks.request(data.lock, () =&gt; leave(port));
    <span class="c">// otherwise it is data.say, and the handler above</span>
  };
};

<span class="c">// the worker: the laptop changes network and the socket closes. connect() runs again.</span>
function connect() {
  socket = new WebSocket("wss://tracker.example/live");
  <span class="c">// ask again for every tab that is still waiting. No tab did anything.</span>
  socket.onopen = () =&gt; { for (const [id, { text }] of pending) socket.send(JSON.stringify({ id, text })); };
  <span class="c">// socket.onmessage and socket.onclose are set here, as above</span>
}`,
    when: "A real case. An issue tracker's server allows each person a small number of connections, and people open ten issues in ten tabs. Every tab asks the worker about its own issue, and the worker sends all the questions over one WebSocket. When the laptop changes network the socket closes, and the worker opens another and asks again what was not answered. The tabs run no code for this and their ports are unchanged. A status question is safe to send twice, which matters because a repeated question may reach the server twice.",
  },

  audio: {
    code: `<span class="c">// a step sequencer. The page loaded bell.js with audio.audioWorklet.addModule("/bell.js").</span>
<span class="c">// It runs on the audio thread and takes the port that came through node.port.</span>
class Bell extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = ({ ports: [notes] }) =&gt; {
      notes.onmessage = ({ data }) =&gt; { this.freq = data.freq; notes.postMessage({ played: true }); };
    };
  }
  process(inputs, outputs) { <span class="c">/* write a tone at this.freq into outputs[0] */</span> return true; }
}
registerProcessor("bell", Bell);

<span class="c">// the composer worker takes the other port and sends one note for each step of the pattern</span>
onmessage = ({ ports: [port] }) =&gt; {
  port.onmessage = () =&gt; { played++; };          <span class="c">// the audio thread says it played the note</span>
  setInterval(() =&gt; port.postMessage({ freq: pattern[step++ % pattern.length] }), 125);
};

<span class="c">// the page holds no port. It wires the node to the speakers, and stops by ending both sides.</span>
node.connect(audio.destination);
stopButton.onclick = () =&gt; { composerWorker.terminate(); audio.close(); };`,
    when: "A real case. A step sequencer runs in a browser tab. The page draws the grid of notes, a worker holds the pattern and sends each note, and an <code>AudioWorkletProcessor</code> makes the sound. When the person presses Play, the page makes one channel and gives one port to the worker and the other to the processor. Later the page is busy for a second, because the person opens a long list of saved patterns. The worker still sends each note and the audio thread still plays it, because the page's only part was to hand out the two ports.",
  },
  swpair: {
    code: `<span class="c">// one company's mail app and calendar app, on two origins. Mail is the florist, the calendar is the library.</span>
<span class="c">// the calendar's worker: answer() reads its own cache and replies on the port that came with the question</span>
async function answer(event) {
  const busy = await (await caches.match("/busy.json")).json();
  event.ports[0].postMessage({ free: !busy.includes(event.data.ask) });
}

<span class="c">// the mail's worker: a mail tab asks if a time is free, and the worker asks the calendar's worker</span>
addEventListener("message", (event) =&gt; {
  if (event.data.time) event.waitUntil(isFree(event.data.time).then((free) =&gt; event.source.postMessage({ free })));
});

async function isFree(time, tries = 2) {
  if (!peer &amp;&amp; !(await join())) return null;          <span class="c">// no page of each app is open to carry a new port</span>
  const reply = new MessageChannel();
  peer.postMessage({ ask: time }, [reply.port2]);
  const answer = await firstMessageOrTimeout(reply.port1, 1500);
  if (answer) return answer.free;
  peer.close(); peer = null;                       <span class="c">// no answer in time. Treat the port as lost.</span>
  return tries &gt; 1 ? isFree(time, tries - 1) : null;  <span class="c">// once more, on a new port</span>
}`,
    when: "A real case. One company runs a mail app and a calendar app on two origins, and each has a service worker with its own Cache Storage. The mail app shows, beside an invitation, whether that time is free. The person opens the calendar from the mail page, the two pages carry one port across, and after that the mail's worker asks the calendar's worker directly, for every mail tab. The interesting moment comes when the browser stops the calendar's worker for being idle: the next question gets no answer in 1.5 seconds, so the mail's worker closes its port, calls <code>join()</code>, and the pages carry a new port across. That repair needs both pages to be open still.",
  },
  "health-pair": {
    code: `<span class="c">// a shop's basket page, and a delivery-price frame from a courier's site</span>
<span class="c">// the same watch() call, with what it returns kept, so that giveUp() can stop the pings</span>
const watcher = watch(health.port1, { every: 1000, misses: 3,
  onState: (state) =&gt; state === "silent" || state === "closed" ? giveUp() : null });

<span class="c">// work goes on the data port: a postcode in, a price out</span>
data.port1.onmessage = (e) =&gt; { deliveryPrice.textContent = e.data; };
postcode.onchange = () =&gt; data.port1.postMessage(postcode.value);

<span class="c">// three pings went unanswered, or the frame said goodbye as it went</span>
function giveUp() {
  watcher.stop();
  data.port1.close(); health.port1.close();
  courierFrame.remove();
  deliveryPrice.textContent = "No delivery price at the moment. You can still order.";
  retryButton.hidden = false;   <span class="c">// a press loads the frame again and sends it two new ports</span>
}`,
    when: "A real case. A shop's basket page embeds a delivery-price frame from a courier's site. The page sends the frame two ports when it loads, one for postcodes and prices and one for pings. If the frame's page crashes, hangs or is navigated away, a postcode posted into the data port gets no price and no error. After three missed pings, or a goodbye, the shop calls <code>giveUp()</code>: it stops the pings, closes its two ports, removes the frame and tells the person they can still order. Without the health port the price would stay at its last value and the person would wait.",
  },
  "health-back": {
    code: `<span class="c">// an address-lookup frame from a postal service, embedded by many shops</span>
<span class="c">// a shop that knows about health checks. This is its onState.</span>
function onState(state) {
  if (state === "alive") lookupNote.textContent = "";
  if (state === "late") lookupNote.textContent = "Address lookup is slow.";
  if (state === "silent" || state === "closed") {
    lookupNote.textContent = "Address lookup has stopped. Type your address below.";
    addressFields.hidden = false;
  }
}

<span class="c">// work is the same whether a health port came back or not</span>
data.port1.onmessage = (e) =&gt; showAddresses(e.data);
postcode.onchange = () =&gt; data.port1.postMessage(postcode.value);

<span class="c">// an older shop has no listener for "health". The port that comes back is never read.</span>
<span class="c">// Its lookups work as before, and it cannot tell when the frame stops.</span>

<span class="c">// the far side's serve(): a postcode in, addresses out, and nothing about health</span>
function serve(data) {
  data.onmessage = (e) =&gt; data.postMessage(addressesFor(e.data));
}`,
    when: "A real case. A postal service offers an address-lookup frame that many shops embed, and each shop sends it one port for postcodes and addresses. The postal service adds health checks to the frame and leaves the lookup messages as they were: the frame now makes a second channel and posts one end back. A shop whose page was written before that has no listener for it, and its lookups work as before. A shop that listens for the health message watches the port, and when the frame goes silent it shows plain address fields for the person to fill in. No shop had to change its code on the day the frame changed.",
  },
  "health-beats": {
    code: `<span class="c">// a slide deck in one window, and its speaker notes in a window the deck opened</span>
<span class="c">// both windows: take the end the other window sent, and listen on it</span>
addEventListener("message", (e) =&gt; {
  if (e.source !== other || e.origin !== origin || e.data !== "beats") return;
  const theirs = e.ports[0];
  listen(theirs, { onState: (state) =&gt; show(state) });
});

<span class="c">// show() in the deck: when the notes have gone, the button that opens them works again</span>
const show = (state) =&gt; { openNotes.disabled = state === "alive" || state === "late"; };

<span class="c">// show() in the notes window: say what has happened to the deck</span>
function show(state) {
  if (state === "alive") notice.textContent = "";
  if (state === "silent") notice.textContent = "The slides are not answering. They may come back.";
  if (state === "closed") { notice.textContent = "The slides have closed."; clearInterval(clock); }
}

<span class="c">// the deck ends the talk and stays open: keep what beat() returns, say goodbye, stop the timer</span>
const beats = beat(mine.port1, { every: 1000 });
endTalk.onclick = () =&gt; { beats.bye(); beats.stop(); };`,
    when: "A real case. A slide deck runs in one window and opens its speaker notes in a second window, which shows the next slide and a clock. Each window makes a channel, beats into one end and posts the other end to the other window. If the notes window is closed or its page hangs, the deck's listener reports it and the deck turns its Open notes button back on. If the deck is closed, the notes window stops its clock and says that the slides have closed. A deck that hangs while it is hidden behind another tab is called silent only after some minutes, because <code>listen()</code> allows a hidden window a minute between beats.",
  },
  "alive-signals": {
    code: `<span class="c">// a document editor open in several tabs, and one SharedWorker that keeps the list of tabs</span>
<span class="c">// a tab: take the lock, and send its name to the worker once the lock is held</span>
const { port } = new SharedWorker("/editor-worker.js");
const name = "alive-" + crypto.randomUUID();
navigator.locks.request(name, () =&gt; {
  port.postMessage({ name });
  return new Promise(() =&gt; {});              <span class="c">// never let go</span>
});

<span class="c">// the worker: queue for each tab's lock. It is granted when that tab is destroyed.</span>
onconnect = ({ ports: [port] }) =&gt; port.onmessage = async ({ data: { name } }) =&gt; {
  tabs.add(port);
  await navigator.locks.request(name, () =&gt; {});
  farSideIsGone(port, name);
};

<span class="c">// the tab closed, crashed or went to another page. Nothing came on its port to say so.</span>
function farSideIsGone(port, name) {
  tabs.delete(port); port.close();
  for (const tab of tabs) tab.postMessage({ left: name });   <span class="c">// the others remove its cursor</span>
}`,
    when: "A real case. A document editor is open in several tabs of one browser, and one SharedWorker keeps the list of tabs so that each tab can show the others' cursors. Each tab holds a Web Lock with a name of its own and sends that name to the worker on its port. The worker shares the tabs' origin, so it can queue for the same lock, and the browser grants it when the tab is closed, navigated away or crashed. Then the worker closes that tab's port and tells the other tabs to remove its cursor. A tab that is hung still holds its lock, so a worker that must notice a hang needs pings or beats as well.",
  },
  "alive-restart": {
    code: `<span class="c">// a document scanner. A text-recognition library in a worker counts the words on page n.</span>
const pending = new Map();           <span class="c">// every question that has no answer yet</span>
let current, next = 0;               <span class="c">// current: work.port1 of the newest worker</span>
start();

<span class="c">// the rest of the app calls this and nothing else</span>
const wordsOnPage = (n) =&gt; new Promise((resolve) =&gt; {
  const id = ++next;
  pending.set(id, { n, resolve });   <span class="c">// kept until answered, so that start() can ask again</span>
  current.postMessage({ id, n });
});

<span class="c">// page 12 is asked for and the worker hangs. Three pings are missed, and start() runs again.</span>
wordCount.textContent = await wordsOnPage(12);   <span class="c">// this line waited longer, and saw nothing else</span>

<span class="c">// the worker: pings on one port, work on the other. answer() is from /alive.js.</span>
onmessage = ({ ports: [work, health] }) =&gt; {
  answer(health);
  work.onmessage = ({ data: { id, n } }) =&gt; work.postMessage({ id, count: countWords(n) });
};`,
    when: "A real case. A document scanner app counts the words on each scanned page with a text-recognition library that runs in a worker. The library is not the app's own code, and now and then it stops answering part way through a page. The app keeps every unanswered question in <code>pending</code>, and the worker answers health pings on a second port. After three missed pings the app terminates the worker, starts another and asks again, so the code that called <code>wordsOnPage(12)</code> gets its number after a longer wait. Counting the words on a page twice does no harm, which is what makes asking again safe.",
  },
};
