// QR Code generator — self-contained, no dependencies, no build step.
//
// Compact ES-module port of Project Nayuki's "QR Code generator library"
// (MIT License, © Project Nayuki, https://www.nayuki.io/page/qr-code-generator-library).
// Trimmed to what MonsterOps needs: encode a short UTF-8 string (an otpauth://
// URI) in byte mode at error-correction level M and render it as crisp SVG.
//
// Public API:
//   qrSvg(text, { moduleColor, background, border, className }) -> SVG string
//   qrModules(text) -> boolean[][]   (row-major, true = dark)

// ── Reed–Solomon / GF(256) ──────────────────────────────────────────────────────
function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) result[i] ^= rsMultiply(divisor[i], factor);
  }
  return result;
}

// Per-version error-correction codewords-per-block and blocks, for EC level M.
const ECC_CODEWORDS_PER_BLOCK_M = [
  -1,
  10,
  16,
  26,
  18,
  24,
  16,
  18,
  22,
  22,
  26,
  30,
  22,
  22,
  24,
  24,
  28,
  28,
  26,
  26,
  26,
  26,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
  28,
];
const NUM_ERROR_CORRECTION_BLOCKS_M = [
  -1,
  1,
  1,
  1,
  2,
  2,
  4,
  4,
  4,
  5,
  5,
  5,
  8,
  9,
  9,
  10,
  10,
  11,
  13,
  14,
  16,
  17,
  17,
  18,
  20,
  21,
  23,
  25,
  26,
  28,
  29,
  31,
  33,
  35,
  37,
  38,
  40,
  43,
  45,
  47,
  49,
];

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver) {
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK_M[ver] * NUM_ERROR_CORRECTION_BLOCKS_M[ver]
  );
}

// ── Encode text (byte mode) → data codewords for the chosen version ──────────────
function encodeBytes(text) {
  const bytes = new TextEncoder().encode(text);

  // Smallest version (1..40) whose data capacity fits: 4-bit mode + length + data.
  let version = 1;
  for (; version <= 40; version++) {
    const capacityBits = numDataCodewords(version) * 8;
    const lenBits = version <= 9 ? 8 : 16;
    const usedBits = 4 + lenBits + bytes.length * 8;
    if (usedBits <= capacityBits) break;
  }
  if (version > 40) throw new Error('QR: data too long');

  const bits = [];
  const append = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  append(0x4, 4); // byte mode indicator
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);

  const dataCapacityBits = numDataCodewords(version) * 8;
  append(0, Math.min(4, dataCapacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0); // pad to byte

  const dataCodewords = new Uint8Array(dataCapacityBits / 8);
  for (let i = 0; i < bits.length; i++) dataCodewords[i >>> 3] |= bits[i] << (7 - (i & 7));
  for (let i = bits.length / 8, pad = 0xec; i < dataCodewords.length; i++, pad ^= 0xec ^ 0x11) {
    dataCodewords[i] = pad;
  }
  return { version, dataCodewords };
}

// Interleave data + ECC blocks per the spec.
function addEcc(version, data) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK_M[version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  const divisor = rsDivisor(eccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, divisor);
    blocks.push({ dat, ecc });
  }

  const result = [];
  for (let i = 0; i < shortLen - eccLen + 1; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i < blocks[j].dat.length) result.push(blocks[j].dat[i]);
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (let j = 0; j < blocks.length; j++) result.push(blocks[j].ecc[i]);
  }
  return result;
}

// ── Module matrix construction ───────────────────────────────────────────────────
function buildMatrix(version, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunction = (x, y, dark) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };
  const drawFinder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          setFunction(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  // Finder patterns + separators
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Alignment patterns
  const alignPositions = () => {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  };
  const aligns = alignPositions();
  for (let i = 0; i < aligns.length; i++) {
    for (let j = 0; j < aligns.length; j++) {
      const isCorner = (i === 0 && j === 0) ||
        (i === 0 && j === aligns.length - 1) ||
        (i === aligns.length - 1 && j === 0);
      if (isCorner) continue;
      const cx = aligns[i];
      const cy = aligns[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve format info (filled after masking) + dark module
  const reserveFormat = () => {
    for (let i = 0; i < 9; i++) {
      isFunction[8][i] = true;
      isFunction[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
      isFunction[8][size - 1 - i] = true;
      isFunction[size - 1 - i][8] = true;
    }
  };
  reserveFormat();
  setFunction(8, size - 8, true); // dark module

  // Version info (version >= 7)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bitsV = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bitsV >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  }

  // Place data codewords (zigzag)
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < totalBits) {
          modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
      }
    }
  }

  return { modules, isFunction, size };
}

function applyMask(modules, isFunction, mask) {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0;
          break;
        case 1:
          invert = y % 2 === 0;
          break;
        case 2:
          invert = x % 3 === 0;
          break;
        case 3:
          invert = (x + y) % 3 === 0;
          break;
        case 4:
          invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
          break;
        case 5:
          invert = ((x * y) % 2) + ((x * y) % 3) === 0;
          break;
        case 6:
          invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
        case 7:
          invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

function drawFormatBits(modules, isFunction, mask) {
  const size = modules.length;
  const data = (0x0 << 3) | mask; // EC level M = 0b00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const set = (x, y, on) => {
    modules[y][x] = on;
    isFunction[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, ((bits >>> i) & 1) === 1);
  set(8, 7, ((bits >>> 6) & 1) === 1);
  set(8, 8, ((bits >>> 7) & 1) === 1);
  set(7, 8, ((bits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) set(14 - i, 8, ((bits >>> i) & 1) === 1);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, ((bits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, ((bits >>> i) & 1) === 1);
}

function penalty(modules) {
  const size = modules.length;
  let p = 0;
  // Rule 1: runs of 5+ same-color in rows/cols
  const runScore = (get) => {
    let s = 0;
    for (let a = 0; a < size; a++) {
      let runColor = get(a, 0);
      let runLen = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === runColor) {
          runLen++;
          if (runLen === 5) s += 3;
          else if (runLen > 5) s += 1;
        } else {
          runColor = get(a, b);
          runLen = 1;
        }
      }
    }
    return s;
  };
  p += runScore((a, b) => modules[a][b]);
  p += runScore((a, b) => modules[b][a]);
  // Rule 2: 2x2 blocks
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) p += 3;
    }
  }
  // Rule 3: finder-like patterns
  const pat = [true, false, true, true, true, false, true];
  const check = (get) => {
    let s = 0;
    for (let a = 0; a < size; a++) {
      for (let b = 0; b <= size - 7; b++) {
        let match = true;
        for (let k = 0; k < 7; k++) {
          if (get(a, b + k) !== pat[k]) {
            match = false;
            break;
          }
        }
        if (!match) continue;
        const before = b - 4 < 0 || [0, 1, 2, 3].every((k) => !get(a, b - 1 - k));
        const after = b + 7 + 3 >= size || [0, 1, 2, 3].every((k) => !get(a, b + 7 + k));
        if (before || after) s += 40;
      }
    }
    return s;
  };
  p += check((a, b) => modules[a][b]);
  p += check((a, b) => modules[b][a]);
  // Rule 4: dark/light balance
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const total = size * size;
  const ratio = (dark * 100) / total;
  p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return p;
}

export function qrModules(text) {
  const { version, dataCodewords } = encodeBytes(text);
  const allCodewords = addEcc(version, dataCodewords);

  let best = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const { modules, isFunction } = buildMatrix(version, allCodewords);
    applyMask(modules, isFunction, mask);
    drawFormatBits(modules, isFunction, mask);
    const pen = penalty(modules);
    if (pen < bestPenalty) {
      bestPenalty = pen;
      best = modules;
    }
  }
  return best;
}

export function qrSvg(text, opts = {}) {
  const moduleColor = opts.moduleColor ?? '#0A0A0A';
  const background = opts.background ?? '#FFFFFF';
  const border = opts.border ?? 4;
  const modules = qrModules(text);
  const size = modules.length;
  const dim = size + border * 2;

  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  const cls = opts.className ? ` class="${opts.className}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"${cls} ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${background}"/>` +
    `<path d="${path}" fill="${moduleColor}"/></svg>`
  );
}
