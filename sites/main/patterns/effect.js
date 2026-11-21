// A blur over RGBA pixels, written the plain way: every pixel is the average
// of the pixels within `radius` of it, first along rows and then along
// columns. It is slow on purpose only in the sense that it is not clever.
// The page and the worker both import this file and run the same function.
export function blur(pixels, width, height, radius = 9) {
  const out = new Uint8ClampedArray(pixels.length);
  const pass = (from, to, stepX, stepY) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k * stepX, yy = y + k * stepY;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const i = (yy * width + xx) * 4;
          r += from[i]; g += from[i + 1]; b += from[i + 2]; n++;
        }
        const o = (y * width + x) * 4;
        to[o] = r / n; to[o + 1] = g / n; to[o + 2] = b / n; to[o + 3] = 255;
      }
    }
  };
  pass(pixels, out, 1, 0);
  pass(out, pixels, 0, 1);
  return pixels;
}
