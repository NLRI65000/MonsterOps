// Shared geolocation display helpers.
//
// Country flags were previously rendered as regional-indicator emoji
// (🇧🇷). Those codepoints don't have glyphs on most desktop browsers
// (Chrome on Windows, most Linux setups) so they silently rendered as
// nothing or as bare "BR" text. We now render real flag images from
// flagcdn.com — consistent with the app already loading its webfonts from
// a CDN. If the network is unavailable the <img> alt text falls back to
// the ISO country code, which is still more useful than an invisible glyph.

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Return an <img> flag for a 2-letter ISO country code, or '' if invalid. */
export function flagImg(cc) {
  if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return '';
  const code = cc.toLowerCase();
  const CC = cc.toUpperCase();
  return (
    `<img class="cc-flag" src="https://flagcdn.com/20x15/${code}.png" ` +
    `srcset="https://flagcdn.com/40x30/${code}.png 2x" ` +
    `width="20" height="15" loading="lazy" decoding="async" ` +
    `alt="${CC}" title="${CC}" ` +
    `style="display:inline-block;vertical-align:-3px;margin-right:5px;` +
    `border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.10);" />`
  );
}

/**
 * Return HTML for a "flag + place" label. Unlike a plain string this returns
 * markup (the flag is an <img>), so callers must NOT wrap it in an escape
 * helper — the place name is already escaped here.
 */
export function geoLabelHTML(geo) {
  if (!geo) return '';
  const place = geo.city || geo.country || '';
  const flag = flagImg(geo.country_code);
  if (!flag && !place) return '';
  return `${flag}<span>${_esc(place)}</span>`;
}
