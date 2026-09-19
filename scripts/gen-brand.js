#!/usr/bin/env node
/**
 * 品牌图裁切与多密度导出（无第三方依赖）。
 *
 * 输入一张方形主图（如 1024x1024 的 app 图标），产出 apply-app-meta.js 期望的目录结构：
 *   <out>/mipmap-<density>/ic_launcher.png        圆角方图（48/72/96/144/192）
 *   <out>/mipmap-<density>/ic_launcher_round.png  圆形（同尺寸）
 *   <out>/drawable-<density>/splash_logo.png      闪屏居中 logo（launcher 的 2 倍）
 *
 * 为什么需要它：设计稿通常只有一张大图（且常带白边、水印、假圆角），
 * 手工切五套密度极易出错；这里把「裁掉外边距 → 自绘圆角/圆形遮罩 → 面积平均缩放」
 * 固化成脚本，改图标只需重跑一条命令。
 *
 * 用法：
 *   node scripts/gen-brand.js --src ../app_h5/app-brand/icon.png --out ../app_h5/app-brand/android
 *   node scripts/gen-brand.js --src icon.png --out out/ --inset 0.085 --radius 0.22 --dry-run
 *
 * 说明：--inset 按主图边长比例裁掉四周留白（设计稿里的白边/阴影/角标水印）；
 *       --radius 圆角半径占最终图标边长的比例（0 = 直角，0.5 = 圆形）。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DENSITIES = [
  { name: 'mdpi', launcher: 48 },
  { name: 'hdpi', launcher: 72 },
  { name: 'xhdpi', launcher: 96 },
  { name: 'xxhdpi', launcher: 144 },
  { name: 'xxxhdpi', launcher: 192 },
];
/** 闪屏 logo 相对 launcher 的倍率（与既有子应用品牌资源保持一致：xxhdpi 144 → 288）。 */
const SPLASH_SCALE = 2;

function fail(msg) {
  console.error(`[gen-brand] ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- PNG 解码

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return ~c >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 解析 PNG，返回 {width, height, data: RGBA Buffer}（仅支持 8bit 非隔行）。 */
function decodePng(buf, label) {
  if (buf.readUInt32BE(0) !== 0x89504e47) fail(`${label} 不是 PNG 文件`);
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let palette = null;
  let trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!ihdr) fail(`${label} 缺少 IHDR`);
  if (ihdr.bitDepth !== 8) fail(`${label} 位深 ${ihdr.bitDepth} 不支持，请导出 8bit PNG`);
  if (ihdr.interlace) fail(`${label} 是隔行（interlaced）PNG，请导出非隔行`);
  if (![0, 2, 3, 6].includes(ihdr.colorType)) fail(`${label} 色彩类型 ${ihdr.colorType} 不支持`);
  if (ihdr.colorType === 3 && !palette) fail(`${label} 调色板缺失`);

  const { width, height, colorType } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);

  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const lineStart = offset;
    const line = raw.subarray(lineStart, lineStart + stride);
    // 上一行的数据区间：每行多 1 字节的滤波类型前缀，所以行间距是 stride + 1
    const prev = y > 0 ? raw.subarray(lineStart - stride - 1, lineStart - 1) : Buffer.alloc(stride);
    offset += stride;
    for (let x = 0; x < stride; x++) {
      let value = line[x];
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) value = (value + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) fail(`${label} 含未知滤波类型 ${filter}`);
      line[x] = value;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (colorType === 6) {
        out[i] = line[x * 4];
        out[i + 1] = line[x * 4 + 1];
        out[i + 2] = line[x * 4 + 2];
        out[i + 3] = line[x * 4 + 3];
      } else if (colorType === 2) {
        out[i] = line[x * 3];
        out[i + 1] = line[x * 3 + 1];
        out[i + 2] = line[x * 3 + 2];
        out[i + 3] = 255;
      } else if (colorType === 0) {
        const g = line[x];
        out[i] = out[i + 1] = out[i + 2] = g;
        out[i + 3] = 255;
      } else {
        const idx = line[x];
        out[i] = palette[idx * 3];
        out[i + 1] = palette[idx * 3 + 1];
        out[i + 2] = palette[idx * 3 + 2];
        out[i + 3] = trns && trns[idx] !== undefined ? trns[idx] : 255;
      }
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------- 图像变换

/** 从 RGBA 缓冲中裁出 left/top 起、size 边长的正方形。 */
function cropSquare(src, sw, left, top, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    src.copy(out, y * size * 4, ((top + y) * sw + left) * 4, ((top + y) * sw + left + size) * 4);
  }
  return out;
}

/** 面积平均缩放（预乘 alpha，避免缩小后边缘出现暗边）。 */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((y + 1) * yRatio)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((x + 1) * xRatio)));
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          const a = src[i + 3];
          sumR += src[i] * a;
          sumG += src[i + 1] * a;
          sumB += src[i + 2] * a;
          sumA += a;
          count++;
        }
      }
      const o = (y * dw + x) * 4;
      const meanA = sumA / count;
      if (meanA < 1) {
        out[o] = out[o + 1] = out[o + 2] = 0;
        out[o + 3] = Math.round(meanA);
        continue;
      }
      out[o] = Math.round(sumR / sumA);
      out[o + 1] = Math.round(sumG / sumA);
      out[o + 2] = Math.round(sumB / sumA);
      out[o + 3] = Math.round(meanA);
    }
  }
  return out;
}

/** 圆角方形遮罩：radiusRatio=0.5 时等价于圆形；边缘用距离场做抗锯齿。 */
function applyRoundMask(img, size, radiusRatio) {
  const r = size * radiusRatio;
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x + 0.5 - half) - (half - r);
      const dy = Math.abs(y + 0.5 - half) - (half - r);
      const ox = Math.max(dx, 0);
      const oy = Math.max(dy, 0);
      const dist = Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
      const coverage = Math.min(1, Math.max(0, 0.5 - dist));
      const i = (y * size + x) * 4;
      img[i + 3] = Math.round(img[i + 3] * coverage);
    }
  }
}

// ---------------------------------------------------------------- PNG 编码

/** 编码为 RGBA PNG（每行 filter 0，deflate 压缩）。 */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const body = [
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...body]);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { inset: 0, radius: 0.22, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--dry-run') args.dryRun = true;
    else if (key === '--src') args.src = argv[++i];
    else if (key === '--out') args.out = argv[++i];
    else if (key === '--inset') args.inset = Number(argv[++i]);
    else if (key === '--radius') args.radius = Number(argv[++i]);
    else fail(`未知参数 ${key}`);
  }
  if (!args.src || !args.out) {
    fail(
      '用法：node scripts/gen-brand.js --src <主图.png> --out <品牌目录> [--inset 0.085] [--radius 0.22]',
    );
  }
  if (!(args.inset >= 0 && args.inset < 0.5)) fail('--inset 需在 [0, 0.5) 区间');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const srcFile = path.resolve(process.cwd(), args.src);
  const outDir = path.resolve(process.cwd(), args.out);
  if (!fs.existsSync(srcFile)) fail(`主图不存在：${srcFile}`);

  const img = decodePng(fs.readFileSync(srcFile), path.basename(srcFile));
  const side = Math.min(img.width, img.height);
  const crop = Math.round(side * (1 - args.inset * 2));
  const left = Math.round((img.width - crop) / 2);
  const top = Math.round((img.height - crop) / 2);
  console.log(
    `[gen-brand] 主图 ${img.width}x${img.height} → 居中裁切 ${crop}x${crop}（inset=${args.inset}）`,
  );

  const base = cropSquare(img.data, img.width, left, top, crop);
  const crops = [];
  for (const d of DENSITIES) {
    for (const item of [
      { size: d.launcher, file: 'ic_launcher.png', dir: `mipmap-${d.name}`, radius: args.radius },
      { size: d.launcher, file: 'ic_launcher_round.png', dir: `mipmap-${d.name}`, radius: 0.5 },
      {
        size: Math.round(d.launcher * SPLASH_SCALE),
        file: 'splash_logo.png',
        dir: `drawable-${d.name}`,
        radius: args.radius,
      },
    ]) {
      // 先在裁切尺寸上加遮罩再缩小：小尺寸直接算遮罩会在圆角处出现锯齿
      const masked = Buffer.from(base);
      applyRoundMask(masked, crop, item.radius);
      const final = resize(masked, crop, crop, item.size, item.size);
      const png = encodePng(item.size, item.size, final);
      crops.push({ dir: item.dir, file: item.file, size: item.size, bytes: png.length, png });
    }
  }

  for (const c of crops) {
    console.log(
      `[gen-brand] ${c.dir}/${c.file}  ${c.size}x${c.size}  ${(c.bytes / 1024).toFixed(1)} KB`,
    );
  }
  if (args.dryRun) {
    console.log('[gen-brand] --dry-run：未写入文件');
    return;
  }
  for (const c of crops) {
    const dir = path.join(outDir, c.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, c.file), c.png);
  }
  console.log(`[gen-brand] 已写入 ${crops.length} 个文件：${outDir}`);
}

main();
