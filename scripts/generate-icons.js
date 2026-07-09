// Petit generateur de PNG sans dependance externe, pour produire des icones
// PWA minimalistes (fond sombre + silhouette de dague rouge sang).
// Usage : node scripts/generate-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generatePng(size) {
  const bg = [10, 10, 13];
  const dagger = [201, 42, 62];
  const hilt = [184, 149, 80];

  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size / 2;
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / size;
      const dy = (y - cx) / size;
      let color = bg;
      // Lame verticale
      if (Math.abs(dx) < 0.035 && dy > -0.32 && dy < 0.28) color = dagger;
      // Pointe
      if (Math.abs(dx) < 0.10 * (1 - Math.max(0, (dy + 0.32) / 0.12)) && dy <= -0.20 && dy > -0.32) color = dagger;
      // Garde
      if (Math.abs(dx) < 0.20 && dy > 0.05 && dy < 0.10) color = hilt;
      // Pommeau / manche
      if (Math.abs(dx) < 0.05 && dy >= 0.10 && dy < 0.34) color = [143, 28, 46];
      const idx = rowStart + 1 + x * 3;
      raw[idx] = color[0];
      raw[idx + 1] = color[1];
      raw[idx + 2] = color[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "public", "icons");
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), generatePng(size));
  console.log(`Genere icon-${size}.png`);
}
