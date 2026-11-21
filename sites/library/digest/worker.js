// A worker that was handed a port into the AI router's frame. It has no window,
// could not have opened the router window itself, and holds no key. The port is
// all it needs.
onmessage = async (event) => {
  const { router, books } = event.data;
  const { fromPort } = await import(router + "/router.js");
  const ai = fromPort(event.ports[0]);
  for (const [i, title] of books.entries()) {
    try {
      let text = "";
      for await (const piece of ai.prompt({ system: "You write one-sentence shelf notes for a public library.", messages: [{ role: "user", content: `Write a one-sentence note recommending the book "${title}".` }], maxTokens: 80 })) {
        text += piece;
        postMessage({ i, text });
      }
    } catch (error) { postMessage({ i, error: error.message }); }
  }
  postMessage({ done: true });
};
