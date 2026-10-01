// Line-icon generator (no deps): 96x96 transparent PNGs, 4x4 supersampled AA.
// Output: miniprogram/images/icons/<name>.png
// Re-run: node scripts/gen-icons.cjs
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "miniprogram", "images", "icons");

// ---------- minimal PNG encoder ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

// ---------- drawing primitives (96x96 unit space, stroke width sw) ----------
const SW = 7;
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
const seg = (x1, y1, x2, y2, w) => (px, py) =>
  distSeg(px, py, x1, y1, x2, y2) <= (w || SW) / 2;
const ring = (cx, cy, r, w) => (px, py) =>
  Math.abs(Math.hypot(px - cx, py - cy) - r) <= (w || SW) / 2;
const disc = (cx, cy, r) => (px, py) => Math.hypot(px - cx, py - cy) <= r;
const rect = (x1, y1, x2, y2) => (px, py) =>
  px >= x1 && px <= x2 && py >= y1 && py <= y2;
const rectOutline = (x1, y1, x2, y2, w) => {
  const outer = rect(x1, y1, x2, y2);
  const inner = rect(x1 + (w || SW), y1 + (w || SW), x2 - (w || SW), y2 - (w || SW));
  return (px, py) => outer(px, py) && !inner(px, py);
};
const or =
  (...fs) =>
  (px, py) =>
    fs.some((f) => f(px, py));
const and =
  (f, g) =>
  (px, py) =>
    f(px, py) && g(px, py);
const upper = (f, cy) => and(f, (px, py) => py <= cy);
const right = (f, cx) => and(f, (px, py) => px >= cx);

// ---------- icon set ----------
const ICONS = {
  // two people: heads + shoulder arcs
  team: or(
    ring(37, 33, 11),
    upper(ring(37, 84, 22), 84),
    ring(65, 38, 8.5),
    upper(ring(65, 88, 16), 88),
  ),
  // price tag: diamond outline + dot
  prices: or(
    seg(48, 22, 74, 48),
    seg(74, 48, 48, 74),
    seg(48, 74, 22, 48),
    seg(22, 48, 48, 22),
    disc(48, 44, 5),
  ),
  // sliders (manage)
  admin: or(
    seg(22, 32, 74, 32),
    seg(22, 48, 74, 48),
    seg(22, 64, 74, 64),
    disc(58, 32, 7),
    disc(38, 48, 7),
    disc(62, 64, 7),
  ),
  // bar chart
  reports: or(
    rect(27, 52, 39, 72),
    rect(43, 40, 55, 72),
    rect(59, 28, 71, 72),
    seg(20, 78, 78, 78),
  ),
  // wallet / card with clasp
  withdrawals: or(
    rectOutline(24, 34, 72, 66),
    seg(24, 46, 72, 46),
    disc(60, 56, 5),
  ),
  // lock
  password: or(
    rectOutline(30, 44, 66, 76),
    upper(ring(48, 44, 12), 44),
    disc(48, 58, 4.5),
    seg(48, 58, 48, 67),
  ),
  // magnifier
  keywords: or(ring(43, 43, 17), seg(56, 56, 72, 72)),
  // document with lines
  works: or(
    rectOutline(30, 22, 66, 74),
    seg(39, 38, 57, 38),
    seg(39, 50, 57, 50),
    seg(39, 62, 51, 62),
  ),
  // trend line with dots
  data: or(
    seg(22, 22, 22, 74),
    seg(22, 74, 76, 74),
    seg(28, 62, 44, 44),
    seg(44, 44, 58, 54),
    seg(58, 54, 74, 32),
    disc(44, 44, 4.5),
    disc(58, 54, 4.5),
  ),
  // title/text
  title: or(
    seg(24, 30, 72, 30),
    seg(24, 48, 72, 48),
    seg(24, 66, 54, 66),
  ),
  // pen (rewrite)
  rewrite: or(
    seg(28, 68, 62, 34),
    seg(62, 34, 70, 26),
    seg(24, 74, 34, 62),
  ),
  // speaker (voice)
  voice: or(
    rect(24, 40, 36, 56),
    seg(36, 40, 52, 28),
    seg(52, 28, 52, 68),
    seg(52, 68, 36, 56),
    right(ring(52, 48, 14), 54),
    right(ring(52, 48, 24), 56),
  ),
  // image (cover)
  cover: or(
    rectOutline(22, 28, 74, 68),
    disc(38, 42, 5),
    seg(30, 68, 46, 50),
    seg(46, 50, 58, 62),
    seg(58, 62, 68, 52),
  ),
  // film strip (clip)
  clip: or(
    rectOutline(22, 32, 74, 64),
    seg(34, 32, 34, 64, 5),
    seg(62, 32, 62, 64, 5),
    seg(22, 48, 74, 48, 5),
  ),
  // person + plus (invite)
  invite: or(
    ring(42, 32, 12),
    upper(ring(42, 82, 24), 82),
    seg(66, 56, 66, 76, 6),
    seg(56, 66, 76, 66, 6),
  ),
};

const COLORS = {
  team: "#214239",
  prices: "#c98f1b",
  admin: "#d05a43",
  reports: "#3a6ea5",
  withdrawals: "#214239",
  password: "#7c8883",
  keywords: "#214239",
  works: "#c98f1b",
  data: "#3a6ea5",
  title: "#214239",
  rewrite: "#214239",
  voice: "#214239",
  cover: "#214239",
  clip: "#214239",
  invite: "#214239",
};

function hex(c) {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
}

const SIZE = 96;
const SS = 4; // 4x4 supersampling per output pixel
for (const [name, draw] of Object.entries(ICONS)) {
  const rgb = hex(COLORS[name] || "#214239");
  writePng(path.join(OUT, name + ".png"), SIZE, (x, y) => {
    let hits = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++)
        if (draw(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
    const alpha = Math.round((hits / (SS * SS)) * 255);
    return [rgb[0], rgb[1], rgb[2], alpha];
  });
  console.log("icon", name);
}
console.log("done:", Object.keys(ICONS).length, "icons");
