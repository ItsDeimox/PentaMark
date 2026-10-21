// Optional authoring tool: install sharp, or set PENTAMARK_SHARP_MODULE to its module path.
const sharp = require(process.env.PENTAMARK_SHARP_MODULE || 'sharp');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
async function build() {
  const svg = readFileSync(join(root, 'public/pentamark-brand.svg'));
  writeFileSync(join(root, 'public/pentamark-icon.svg'), svg);
  for (const size of [192, 512]) {
    await sharp(svg).resize(size, size).png().toFile(join(root, `public/pentamark-icon-${size}.png`));
  }
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, i) => {
    const entry = 6 + 16 * i;
    header[entry] = sizes[i] === 256 ? 0 : sizes[i];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  writeFileSync(join(root, 'build/pentamark.ico'), Buffer.concat([header, ...images]));
  // NSIS mostra este bitmap antes do Electron iniciar, durante a extração.
  const splashSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="460" height="320"><rect width="460" height="320" fill="#090c0f"/><image x="184" y="52" width="92" height="92" href="data:image/svg+xml;base64,${svg.toString('base64')}"/><text x="230" y="193" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#edf4f5">PentaMark</text><text x="230" y="224" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#93a5ab">Iniciando seu espaço de escrita…</text><rect x="150" y="252" width="160" height="2" fill="#67e7ef"/></svg>`);
  const pixels = await sharp(splashSvg).removeAlpha().raw().toBuffer();
  const stride = Math.ceil(460 * 3 / 4) * 4;
  const bmp = Buffer.alloc(54 + stride * 320);
  bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(460, 18); bmp.writeInt32LE(320, 22);
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * 320, 34);
  for (let y = 0; y < 320; y++) for (let x = 0; x < 460; x++) {
    const src = (y * 460 + x) * 3, dst = 54 + (319 - y) * stride + x * 3;
    bmp[dst] = pixels[src + 2]; bmp[dst + 1] = pixels[src + 1]; bmp[dst + 2] = pixels[src];
  }
  writeFileSync(join(root, 'build/splash.bmp'), bmp);
  console.log('Marca SVG, PNG 192/512 e ICO 16–256 gerados da mesma fonte.');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
