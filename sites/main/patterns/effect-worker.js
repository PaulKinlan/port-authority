// Runs the blur from effect.js off the main thread. The pixels arrive as a
// transferred buffer and go back the same way, so nothing is copied.
import { blur } from "/patterns/effect.js";

onmessage = ({ data }) => {
  const started = performance.now();
  const pixels = blur(new Uint8ClampedArray(data.buffer), data.width, data.height);
  postMessage({ buffer: pixels.buffer, took: Math.round(performance.now() - started) }, [pixels.buffer]);
};
