// Receives either a camera track, or a stream of frames cut from one, and counts frames.
onmessage = async ({ data }) => {
  if (data.track) return postMessage({ got: "track", kind: data.track.kind });
  if (data.frames) {
    const reader = data.frames.getReader();
    let n = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      value.close();
      if (++n % 10 === 0 || n === 1) postMessage({ frames: n });
    }
  }
};
onmessageerror = () => postMessage({ unreadable: true });
