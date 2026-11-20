// The worker behind the explorer on /comlink/. The same Mandelbrot code is
// exposed two ways, chosen by the worker's name:
//   Comlink: frame() works out a whole picture and returns it.
//   Hawser:  rows() is an async generator that hands over a band at a time
//            and stops when the caller's AbortSignal says so.
import { expose, transfer } from "/hawser.js";
import * as Comlink from "/vendor/comlink.mjs";

// Navy, teal, yellow, red, and back: the site's colours.
const STOPS = [[15, 28, 63], [14, 159, 142], [245, 183, 0], [224, 54, 76], [15, 28, 63]];
function colour(t, out, i) {
  const x = (t % 1) * (STOPS.length - 1), k = Math.floor(x), f = x - k;
  const a = STOPS[k], b = STOPS[k + 1];
  out[i] = a[0] + (b[0] - a[0]) * f; out[i + 1] = a[1] + (b[1] - a[1]) * f; out[i + 2] = a[2] + (b[2] - a[2]) * f; out[i + 3] = 255;
}

// Fill rows y0..y1 of a width x height picture of `view` into a new buffer.
function band(view, width, height, y0, y1) {
  const pixels = new Uint8ClampedArray(width * (y1 - y0) * 4);
  const step = view.scale / width, left = view.cx - view.scale / 2, top = view.cy - (step * height) / 2;
  const limit = view.limit;
  for (let y = y0, i = 0; y < y1; y++) {
    const ci = top + y * step;
    for (let x = 0; x < width; x++, i += 4) {
      const cr = left + x * step;
      let zr = 0, zi = 0, n = 0, r2 = 0, i2 = 0;
      while (n < limit && r2 + i2 <= 16) { zi = 2 * zr * zi + ci; zr = r2 - i2 + cr; r2 = zr * zr; i2 = zi * zi; n++; }
      if (n >= limit) { pixels[i] = 9; pixels[i + 1] = 14; pixels[i + 2] = 36; pixels[i + 3] = 255; }
      else colour((n + 1 - Math.log2(Math.log2(r2 + i2) / 2)) / 48 + 0.02, pixels, i);
    }
  }
  return pixels;
}

const api = {
  // One band per pull. Nothing is worked out until the reader asks for it,
  // and an abort is seen before the next band starts.
  async *rows(view, width, height, signal) {
    const rowsPerBand = 12;
    for (let y = 0; y < height && !signal?.aborted; y += rowsPerBand) {
      const started = performance.now();
      const pixels = band(view, width, height, y, Math.min(height, y + rowsPerBand));
      yield { y, pixels: transfer(pixels), ms: performance.now() - started };
    }
  },
  frame(view, width, height) {
    const started = performance.now();
    const pixels = band(view, width, height, 0, height);
    return Comlink.transfer({ pixels, ms: performance.now() - started }, [pixels.buffer]);
  },
};

if (self.name === "comlink") Comlink.expose(api);
else expose(api, self);
