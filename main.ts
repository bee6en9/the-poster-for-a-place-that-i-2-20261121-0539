// VELMORA — Isles Above the Clouds
// A travel poster for a place that isn't there.
// Node 22, standard library only. No network. Deterministic (fixed seed).
// Writes entry.png (1024x1024) into $MAKEFUN_OUTPUT_DIR (default "out").
//
// The picture is painted pixel by pixel into an RGBA buffer: a golden-hour
// sky over a sea of clouds, one floating island carrying a single lighthouse,
// a waterfall spilling off the island's edge, a small airship, distant birds.
// The name VELMORA is drawn large with a hand-built 5x7 bitmap font scaled
// up, so the place name is unmistakable at poster size.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "out";

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32, fixed seed) — no Date.now / Math.random.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);

// ---------------------------------------------------------------------------
// Pixel buffer + drawing primitives
// ---------------------------------------------------------------------------
const px = new Uint8Array(W * H * 4);
type RGB = [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Alpha-composite one pixel over what is already there.
function setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  if (a >= 1) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    return;
  }
  const inv = 1 - a;
  px[i] = clamp255(r * a + px[i] * inv);
  px[i + 1] = clamp255(g * a + px[i + 1] * inv);
  px[i + 2] = clamp255(b * a + px[i + 2] * inv);
  px[i + 3] = 255;
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, c[0], c[1], c[2], a);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Vertical gradient over the whole canvas from colour stops [y, color].
function verticalGradient(stops: Array<[number, RGB]>): void {
  for (let y = 0; y < H; y++) {
    let c: RGB = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      const [y0, c0] = stops[s];
      const [y1, c1] = stops[s + 1];
      if (y >= y0 && y <= y1) {
        c = mixColor(c0, c1, (y - y0) / Math.max(1, y1 - y0));
        break;
      }
    }
    for (let x = 0; x < W; x++) setPixel(x, y, c[0], c[1], c[2], 1);
  }
}

// Filled ellipse with a soft 1.5px edge.
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(cx - rx - 2));
  const y0 = Math.max(0, Math.floor(cy - ry - 2));
  const x1 = Math.min(W, Math.ceil(cx + rx + 2));
  const y1 = Math.min(H, Math.ceil(cy + ry + 2));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const edge = d > 0.92 ? (1 - d) / 0.08 : 1;
        setPixel(x, y, c[0], c[1], c[2], a * Math.min(1, edge));
      }
    }
  }
}

function circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  ellipse(cx, cy, r, r, c, a);
}

// Radial glow: colour fading to transparent over radius r.
function glow(cx: number, cy: number, r: number, c: RGB, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W, Math.ceil(cx + r));
  const y1 = Math.min(H, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) setPixel(x, y, c[0], c[1], c[2], peak * (1 - d) * (1 - d));
    }
  }
}

// Scanline polygon fill; colourFn(y) picks the colour for each row.
function polygon(points: Array<[number, number]>, colourFn: (y: number) => RGB, alpha = 1): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    const c = colourFn(y);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) {
        setPixel(x, y, c[0], c[1], c[2], alpha);
      }
    }
  }
}

// Thick line (drawn as a chain of small circles) — used for birds, rails.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    circle(lerp(x0, x1, t), lerp(y0, y1, t), w / 2, c, a);
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (hand-built). Letters needed: A B C D E H I L M O R S T U V
// ---------------------------------------------------------------------------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
};

function textWidth(text: string, scale: number, spacing: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch === " " ? 3 * scale : 5 * scale;
    w += spacing;
  }
  return w - spacing;
}

function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB, a = 1): void {
  const glyph = FONT[ch];
  if (!glyph) return;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (glyph[row][col] === "1") {
        fillRect(x + col * scale, y + row * scale, scale, scale, c, a);
      }
    }
  }
}

// Centre text horizontally at cx, top edge at y. A soft dark shadow is drawn
// first so the letters stay legible over the bright sky.
function drawText(text: string, cx: number, y: number, scale: number, spacing: number, c: RGB): void {
  const w = textWidth(text, scale, spacing);
  let x = cx - w / 2;
  const shadow: RGB = [18, 12, 48];
  for (const ch of text) {
    if (ch !== " ") {
      drawGlyph(ch, x + 3, y + 4, scale, shadow, 0.55);
      drawGlyph(ch, x, y, scale, c, 1);
    }
    x += (ch === " " ? 3 : 5) * scale + spacing;
  }
}

// Small filled diamond (decoration flanking the tagline).
function diamond(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  polygon([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], () => c, a);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const INDIGO: RGB = [23, 18, 56];
const VIOLET: RGB = [61, 37, 96];
const MAUVE: RGB = [122, 63, 110];
const EMBER: RGB = [217, 123, 74];
const GOLD: RGB = [242, 178, 92];
const SUN_CORE: RGB = [255, 217, 138];
const CREAM: RGB = [247, 234, 208];
const TITLE_GOLD: RGB = [246, 196, 83];
const TEAL_DARK: RGB = [31, 94, 78];
const TEAL: RGB = [47, 143, 110];
const TEAL_LIGHT: RGB = [87, 185, 138];
const ROCK_TOP: RGB = [122, 82, 56];
const ROCK_BOT: RGB = [46, 33, 56];
const CLOUD_CREAM: RGB = [250, 231, 199];
const CLOUD_PINK: RGB = [238, 183, 148];
const CLOUD_LILAC: RGB = [168, 138, 178];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

// 1. Sky: deep indigo at the top warming to gold at the horizon.
verticalGradient([
  [0, INDIGO],
  [300, VIOLET],
  [500, MAUVE],
  [640, EMBER],
  [720, GOLD],
  [1024, [96, 62, 96]],
]);

// 2. Stars in the upper sky (fixed seed, so identical every run).
for (let i = 0; i < 110; i++) {
  const x = rand() * W;
  const y = rand() * 330;
  const a = 0.25 + rand() * 0.6;
  const r = rand() < 0.12 ? 2 : 1;
  circle(x, y, r, [255, 244, 214], a * (1 - y / 420));
}

// 3. Golden-hour sun, low on the horizon at the right.
glow(745, 615, 210, [255, 176, 92], 0.55);
glow(745, 615, 120, [255, 205, 120], 0.7);
circle(745, 615, 58, SUN_CORE, 1);
circle(745, 615, 46, [255, 226, 160], 1);

// 4. Distant floating islets, small and hazy.
function distantIslet(cx: number, cy: number, s: number): void {
  polygon(
    [[cx - 52 * s, cy], [cx + 52 * s, cy], [cx, cy + 46 * s]],
    () => [72, 52, 96],
    0.85,
  );
  ellipse(cx, cy - 4 * s, 54 * s, 12 * s, [74, 96, 96], 0.85);
}
distantIslet(180, 668, 0.9);
distantIslet(892, 692, 0.7);

// 5. Sea of clouds: layered soft puffs from the horizon to the bottom edge.
function cloudPuff(cx: number, cy: number, s: number, c: RGB, a: number): void {
  ellipse(cx, cy, 95 * s, 26 * s, c, a);
  ellipse(cx - 55 * s, cy + 8 * s, 60 * s, 20 * s, c, a);
  ellipse(cx + 55 * s, cy + 8 * s, 62 * s, 20 * s, c, a);
  ellipse(cx, cy - 12 * s, 55 * s, 18 * s, c, a);
}
for (let i = 0; i < 46; i++) {
  const cx = rand() * W;
  const cy = 700 + rand() * 320;
  const s = 0.7 + rand() * 1.1;
  const nearSun = Math.abs(cx - 745) < 260 && cy < 820;
  const c = nearSun
    ? rand() < 0.5 ? CLOUD_CREAM : [252, 205, 140]
    : rand() < 0.45 ? CLOUD_CREAM : rand() < 0.5 ? CLOUD_PINK : CLOUD_LILAC;
  cloudPuff(cx, cy, s, c, 0.5 + rand() * 0.4);
}
// A few high wisps drifting above the cloud sea.
for (let i = 0; i < 8; i++) {
  cloudPuff(80 + rand() * 864, 560 + rand() * 110, 0.5 + rand() * 0.5, CLOUD_CREAM, 0.28);
}

// 6. The main floating island: grassy teal top, rocky underside tapering
//    down to a point, lit warm on the sun side (right).
polygon(
  [[288, 522], [712, 522], [500, 818]],
  (y) => mixColor(ROCK_TOP, ROCK_BOT, (y - 522) / 296),
  1,
);
// Rocky facets / shading on the underside.
polygon([[520, 522], [712, 522], [500, 818]], () => [58, 40, 62], 0.35);
polygon([[288, 522], [470, 522], [500, 818]], () => [150, 104, 70], 0.25);
polygon([[640, 560], [690, 560], [560, 760], [610, 700]], () => [96, 64, 46], 0.5);
// Warm rim light on the sun-facing edge.
thickLine(700, 530, 500, 812, 5, [255, 196, 110], 0.5);
// Grassy plateau.
ellipse(500, 520, 214, 36, TEAL, 1);
ellipse(500, 514, 200, 28, TEAL_LIGHT, 0.85);
// Grass fringe bumps along the plateau edge.
for (let i = 0; i < 14; i++) {
  const x = 310 + i * 28 + (rand() - 0.5) * 8;
  circle(x, 516 + (rand() - 0.5) * 6, 9 + rand() * 6, i % 3 === 0 ? TEAL_LIGHT : TEAL_DARK, 0.9);
}
// Bushes and two small trees on the island.
ellipse(362, 502, 26, 16, TEAL_DARK, 1);
ellipse(648, 498, 22, 14, TEAL_DARK, 1);
ellipse(420, 508, 18, 11, TEAL_DARK, 1);
circle(420, 496, 12, TEAL_DARK, 1);

// 7. Waterfall spilling off the island's right edge into the cloud sea.
polygon(
  [[648, 528], [676, 528], [688, 762], [660, 762]],
  () => [207, 232, 242],
  0.92,
);
for (let i = 0; i < 5; i++) {
  const x0 = 654 + i * 6;
  thickLine(x0, 534, x0 + 8, 756, 2.5, [255, 255, 255], 0.55);
}
// Mist where the fall meets the clouds.
ellipse(674, 768, 46, 16, [255, 255, 255], 0.5);
ellipse(648, 776, 34, 12, [255, 255, 255], 0.45);
ellipse(700, 776, 30, 11, [255, 255, 255], 0.4);

// 8. The lighthouse — the poster's single landmark — standing on the island.
const lampX = 500;
const lampY = 330;
// Light beams: short, narrow, warm cones (drawn first, behind the tower).
polygon([[lampX, lampY], [258, 306], [258, 356]], () => [255, 214, 120], 0.1);
polygon([[lampX, lampY], [742, 310], [742, 352]], () => [255, 214, 120], 0.1);
polygon([[lampX, lampY], [330, 318], [330, 344]], () => [255, 226, 150], 0.12);
polygon([[lampX, lampY], [668, 320], [668, 342]], () => [255, 226, 150], 0.12);
glow(lampX, lampY, 95, [255, 214, 120], 0.5);
// Tower: tapered, cream with two gold bands.
for (let y = 346; y < 522; y++) {
  const t = (y - 346) / (522 - 346);
  const half = lerp(19, 32, t);
  const inBand = (y >= 392 && y < 414) || (y >= 458 && y < 480);
  const c = inBand ? [217, 154, 60] : CREAM;
  const shade = y > 440 ? 0.92 : 1;
  for (let x = Math.ceil(lampX - half); x <= Math.floor(lampX + half); x++) {
    setPixel(x, y, c[0] * shade, c[1] * shade, c[2] * shade, 1);
  }
}
// Tower base plinth.
fillRect(458, 512, 84, 12, [122, 82, 56], 1);
// Lamp room: dark frame, glowing panes.
fillRect(478, 314, 44, 34, [42, 30, 74], 1);
fillRect(484, 320, 9, 22, SUN_CORE, 1);
fillRect(497, 320, 9, 22, SUN_CORE, 1);
fillRect(510, 320, 9, 22, SUN_CORE, 1);
// Gallery rail + dome + finial.
fillRect(474, 310, 52, 5, [42, 30, 74], 1);
ellipse(500, 310, 24, 12, [217, 154, 60], 1);
circle(500, 296, 4, [255, 226, 160], 1);
glow(500, 330, 60, [255, 220, 130], 0.6);

// 9. One small airship drifting to the right of the lighthouse.
ellipse(822, 296, 56, 17, [247, 226, 178], 1);
ellipse(822, 292, 56, 10, [255, 240, 200], 0.9);
fillRect(800, 292, 8, 26, [217, 154, 60], 1);
fillRect(836, 292, 8, 26, [217, 154, 60], 1);
polygon([[868, 296], [884, 284], [884, 308]], () => [196, 120, 70], 1);
fillRect(806, 314, 32, 12, [74, 52, 84], 1);
circle(822, 320, 3, SUN_CORE, 1);
thickLine(766, 296, 756, 296, 2, [247, 226, 178], 0.8);

// 10. Distant birds — a few small strokes in the open sky.
function bird(x: number, y: number, s: number): void {
  thickLine(x - 9 * s, y, x, y - 6 * s, 2.5, INDIGO, 0.8);
  thickLine(x, y - 6 * s, x + 9 * s, y, 2.5, INDIGO, 0.8);
}
bird(252, 232, 1);
bird(292, 262, 0.7);
bird(712, 196, 0.9);
bird(748, 226, 0.65);
bird(180, 330, 0.8);

// 11. Foreground cloud puffs overlapping the bottom of the falls and island.
cloudPuff(300, 900, 1.4, CLOUD_CREAM, 0.85);
cloudPuff(760, 940, 1.5, CLOUD_PINK, 0.8);
cloudPuff(120, 990, 1.3, CLOUD_LILAC, 0.8);
cloudPuff(920, 1000, 1.2, CLOUD_CREAM, 0.85);

// 12. Title + tagline, centred at the top: the eye starts here, then drops
//     to the lighthouse, then to the horizon and the sea of clouds.
drawText("VELMORA", 512, 62, 18, 18, TITLE_GOLD);
fillRect(372, 210, 280, 3, TITLE_GOLD, 0.9);
diamond(352, 211, 6, TITLE_GOLD, 1);
diamond(672, 211, 6, TITLE_GOLD, 1);
drawText("ISLES ABOVE THE CLOUDS", 512, 232, 5, 7, CREAM);

// 13. Thin gold poster frame.
fillRect(24, 24, 976, 3, TITLE_GOLD, 0.85);
fillRect(24, 997, 976, 3, TITLE_GOLD, 0.85);
fillRect(24, 24, 3, 976, TITLE_GOLD, 0.85);
fillRect(997, 24, 3, 976, TITLE_GOLD, 0.85);

// ---------------------------------------------------------------------------
// PNG encoding (manual: IHDR / IDAT with zlib deflate / IEND), filter None.
// ---------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type 6 = RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Raw scanlines: filter byte 0 + RGBA rows.
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  raw.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, "entry.png");
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
