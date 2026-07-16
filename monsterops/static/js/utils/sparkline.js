// sparkline.js — tiny inline SVG telemetry.
// Deliberately small: a readout you glance at, not a chart you study.
//
//   import { sparkline } from '/js/utils/sparkline.js';
//   el.innerHTML = sparkline([3,5,4,8,6,9], { w: 64, h: 18, tone: 'accept' });
//
// Styling comes from theme.css (.sparkline .spark-line/.spark-area/.spark-dot),
// so the trace follows the active accent/semantic tokens automatically.

/**
 * @param {number[]} values  series, oldest → newest
 * @param {object}   [opts]
 * @param {number}   [opts.w=64]     width in px
 * @param {number}   [opts.h=18]     height in px
 * @param {string}   [opts.tone]     '' | 'accept' | 'reject' (semantic color)
 * @param {boolean}  [opts.area=true]  fill under the line
 * @param {boolean}  [opts.dot=true]   mark the latest point
 * @returns {string} HTML string
 */
export function sparkline(values, opts = {}) {
  const { w = 64, h = 18, tone = '', area = true, dot = true } = opts;
  const data = (values || []).filter((v) => Number.isFinite(v));
  const cls = `sparkline${tone ? ' ' + tone : ''}`;

  if (data.length === 0) {
    return `<span class="${cls}" aria-hidden="true"><svg width="${w}" height="${h}"></svg></span>`;
  }
  if (data.length === 1) data.unshift(data[0]);

  const pad = 1.5;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (data.length - 1);

  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y];
  });

  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${
    pts[0][0].toFixed(1)
  },${h} Z`;
  const [lx, ly] = pts[pts.length - 1];

  return `<span class="${cls}" aria-hidden="true"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    (area ? `<path class="spark-area" d="${areaPath}"/>` : '') +
    `<path class="spark-line" d="${line}"/>` +
    (dot ? `<circle class="spark-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="1.6"/>` : '') +
    `</svg></span>`;
}

/**
 * Graylog-style volume histogram — vertical bars, optionally stacking two
 * series (ok on the bottom, bad on top). Colors follow the accept/reject tokens.
 *
 * @param {Array<{ok?:number, bad?:number}>} buckets  oldest → newest
 * @param {object} [opts]
 * @param {number} [opts.h=40]    height in px
 * @param {number} [opts.bar=8]   bar width in px
 * @param {number} [opts.gap=2]   gap between bars
 * @returns {string} HTML string
 */
export function histogram(buckets, opts = {}) {
  const { h = 40, bar = 8, gap = 2 } = opts;
  const data = buckets || [];
  const w = Math.max(1, data.length * (bar + gap) - gap);
  const max = Math.max(1, ...data.map((b) => (b.ok || 0) + (b.bad || 0)));

  const rects = data.map((b, i) => {
    const ok = b.ok || 0;
    const bad = b.bad || 0;
    const x = i * (bar + gap);
    const okH = (ok / max) * h;
    const badH = (bad / max) * h;
    let out = '';
    if (badH > 0) {
      out += `<rect x="${x}" y="${(h - okH - badH).toFixed(1)}" width="${bar}" height="${
        badH.toFixed(1)
      }" fill="var(--mr-reject)"/>`;
    }
    if (okH > 0) {
      out += `<rect x="${x}" y="${(h - okH).toFixed(1)}" width="${bar}" height="${
        okH.toFixed(1)
      }" fill="var(--mr-accept)"/>`;
    }
    if (okH + badH === 0) {
      out += `<rect x="${x}" y="${h - 1}" width="${bar}" height="1" fill="var(--mr-hairline)"/>`;
    }
    return out;
  }).join('');

  return `<span class="histogram" aria-hidden="true"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rects}</svg></span>`;
}
