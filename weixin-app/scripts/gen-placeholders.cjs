// Placeholder image generator (no deps): brand-gradient PNGs with soft circles.
// Outputs:
//   miniprogram/images/courses/{silver,gold,elite}.png   750x420 course covers
//   miniprogram/images/banners/banner-{1,2,3}.png        750x300 home banners
// Re-run: node scripts/gen-placeholders.cjs
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "miniprogram", "images");

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
function encodePng(width, height, pixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hex(c) {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
}
// diagonal gradient + translucent circles
function painter(c1, c2, circles) {
  const a = hex(c1);
  const b = hex(c2);
  return (W, H) => (x, y) => {
    const t = (x / W) * 0.65 + (y / H) * 0.35;
    let r = a[0] + (b[0] - a[0]) * t;
    let g = a[1] + (b[1] - a[1]) * t;
    let bl = a[2] + (b[2] - a[2]) * t;
    for (const circle of circles || []) {
      const dx = (x - circle.x * W) / (circle.r * W);
      const dy = (y - circle.y * H) / (circle.r * W);
      if (dx * dx + dy * dy < 1) {
        const col = hex(circle.color);
        const alpha = circle.alpha;
        r = r * (1 - alpha) + col[0] * alpha;
        g = g * (1 - alpha) + col[1] * alpha;
        bl = bl * (1 - alpha) + col[2] * alpha;
      }
    }
    return [r | 0, g | 0, bl | 0, 255];
  };
}

const IMAGES = [
  // course covers 750x420
  {
    file: "courses/silver.png",
    w: 750,
    h: 420,
    make: painter("#dfe9e3", "#a8bfb2", [
      { x: 0.82, y: 0.25, r: 0.3, color: "#5f7f6f", alpha: 0.22 },
      { x: 0.15, y: 0.85, r: 0.22, color: "#214239", alpha: 0.12 },
    ]),
  },
  {
    file: "courses/gold.png",
    w: 750,
    h: 420,
    make: painter("#faf0d8", "#e7c87e", [
      { x: 0.8, y: 0.3, r: 0.28, color: "#c98f1b", alpha: 0.25 },
      { x: 0.12, y: 0.8, r: 0.2, color: "#ffffff", alpha: 0.25 },
    ]),
  },
  {
    file: "courses/elite.png",
    w: 750,
    h: 420,
    make: painter("#17352e", "#2f6b52", [
      { x: 0.85, y: 0.2, r: 0.32, color: "#ffffff", alpha: 0.1 },
      { x: 0.1, y: 0.9, r: 0.24, color: "#c98f1b", alpha: 0.18 },
    ]),
  },
  // home banners 750x300
  {
    file: "banners/banner-1.png",
    w: 750,
    h: 300,
    make: painter("#17352e", "#3d7a5a", [
      { x: 0.88, y: 0.2, r: 0.35, color: "#ffffff", alpha: 0.1 },
      { x: 0.7, y: 0.95, r: 0.25, color: "#c98f1b", alpha: 0.16 },
    ]),
  },
  {
    file: "banners/banner-2.png",
    w: 750,
    h: 300,
    make: painter("#214239", "#5f7f6f", [
      { x: 0.12, y: 0.15, r: 0.28, color: "#ffffff", alpha: 0.08 },
      { x: 0.9, y: 0.85, r: 0.3, color: "#17352e", alpha: 0.25 },
    ]),
  },
  {
    file: "banners/banner-3.png",
    w: 750,
    h: 300,
    make: painter("#2f6b52", "#c9a13b", [
      { x: 0.85, y: 0.25, r: 0.3, color: "#ffffff", alpha: 0.14 },
      { x: 0.08, y: 0.9, r: 0.22, color: "#17352e", alpha: 0.2 },
    ]),
  },
];

for (const img of IMAGES) {
  const target = path.join(ROOT, img.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encodePng(img.w, img.h, img.make(img.w, img.h)));
  const kb = (fs.statSync(target).size / 1024).toFixed(1);
  console.log("generated", img.file, kb + "KB");
}
