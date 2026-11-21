// A QR code for a short piece of text, such as a link to open on a phone.
// Byte mode, error correction level L, versions 1 to 5 (up to 106 bytes).
// Returns the code as rows of booleans, or as an SVG string.

const DATA = [0, 19, 34, 55, 80, 108];    // data bytes per version
const EC = [0, 7, 10, 15, 20, 26];        // error correction bytes per version

// Reed-Solomon over GF(256), as the QR standard defines it.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function remainder(data, count) {
  let gen = [1];
  for (let i = 0; i < count; i++) { const next = new Array(gen.length + 1).fill(0); gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, EXP[i]); }); gen = next; }
  const rem = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < count; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

export function qr(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = DATA.findIndex((capacity, v) => v && bytes.length + 2 <= capacity);
  if (version < 1) throw new Error("too long for this QR encoder");
  const size = 17 + 4 * version;

  // The message: mode, length, the bytes, then padding.
  const bits = [];
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  put(4, 4); put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, DATA[version] * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < DATA[version]; pad ^= 0xec ^ 0x11) data.push(pad);
  const all = [...data, ...remainder(data, EC[version])];

  const cells = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { cells[y][x] = !!dark; fixed[y][x] = true; } };
  // Three finder patterns with their quiet borders, the timing lines, one alignment pattern.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  if (version > 1) { const c = size - 7; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const format = (mask) => {
    const value = (1 << 3) | mask;      // level L, and which mask
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const code = ((value << 10) | rem) ^ 0x5412;
    const bit = (i) => (code >> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);

  // The data, in a zigzag up and down pairs of columns from the right.
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fixed[y][x] && n < all.length * 8) { cells[y][x] = ((all[n >> 3] >> (7 - (n & 7))) & 1) === 1; n++; }
    }
  }

  // Try each of the eight masks and keep the one with the fewest long runs.
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const flipWith = (mask) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) cells[y][x] = !cells[y][x]; };
  const score = () => {
    let penalty = 0, dark = 0;
    for (let a = 0; a < size; a++) for (const line of [cells[a], cells.map((row) => row[a])]) {
      let run = 1;
      for (let i = 1; i <= size; i++) { if (i < size && line[i] === line[i - 1]) run++; else { if (run >= 5) penalty += run - 2; run = 1; } }
    }
    for (const row of cells) for (const cell of row) dark += cell;
    return penalty + Math.floor(Math.abs(dark * 20 / (size * size) - 10)) * 10;
  };
  let best = 0, least = Infinity;
  for (let mask = 0; mask < 8; mask++) { format(mask); flipWith(mask); const s = score(); if (s < least) { least = s; best = mask; } flipWith(mask); }
  format(best); flipWith(best);
  return cells;
}

// The same code as an SVG, with the quiet margin a scanner needs.
export function qrSvg(text, { label = "QR code" } = {}) {
  const cells = qr(text), size = cells.length + 8;
  let d = "";
  cells.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4},${y + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
