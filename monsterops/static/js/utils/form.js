// ── form validation helpers ─────────────────────────────────────────────────
// Field-level, inline validation errors — the "field-level errors instead of a
// generic toast" pattern (roadmap #7/#8).
//
// These are deliberately DOM-agnostic and style INLINE rather than via a CSS
// class. Forms live in a mix of light DOM, per-module shadow roots, and
// body-appended modals; a stylesheet in one place won't reach a field in
// another. Inline styles (with theme custom-properties + hard fallbacks) render
// the same everywhere.

const ERR_CLASS = 'mr-field-error';
const RED = 'var(--mr-reject, var(--color-danger, #ef4444))';
const ERR_STYLE = `color:${RED};font-size:0.76rem;margin-top:0.3rem;line-height:1.4;`;

/**
 * Mark `input` invalid and show `message` directly beneath it. Idempotent —
 * calling again updates the message. The error auto-clears as soon as the user
 * edits the field, so it never lingers after they start fixing it.
 */
export function setFieldError(input, message) {
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.dataset.mrInvalid = '1';
  if (!('mrBorder' in input.dataset)) input.dataset.mrBorder = input.style.borderColor;
  input.style.borderColor = RED;

  let el = input.nextElementSibling;
  if (!el || !el.classList.contains(ERR_CLASS)) {
    el = document.createElement('div');
    el.className = ERR_CLASS;
    el.setAttribute('style', ERR_STYLE);
    el.setAttribute('role', 'alert');
    input.insertAdjacentElement('afterend', el);
  }
  el.textContent = message;

  input.addEventListener('input', () => clearFieldError(input), { once: true });
  input.addEventListener('change', () => clearFieldError(input), { once: true });
}

/** Clear the invalid state + message for a single input. */
export function clearFieldError(input) {
  if (!input) return;
  input.removeAttribute('aria-invalid');
  delete input.dataset.mrInvalid;
  if ('mrBorder' in input.dataset) {
    input.style.borderColor = input.dataset.mrBorder;
    delete input.dataset.mrBorder;
  }
  const el = input.nextElementSibling;
  if (el && el.classList.contains(ERR_CLASS)) el.remove();
}

/** Clear every field error within `root` (call before re-validating a form). */
export function clearFieldErrors(root) {
  if (!root) return;
  root.querySelectorAll('[data-mr-invalid]').forEach(clearFieldError);
  root.querySelectorAll('.' + ERR_CLASS).forEach((el) => el.remove());
}

/**
 * Place a thrown api error's server-side validation errors onto the matching
 * inputs within `root`. `err.fields` is the { field: message } map that api.js
 * builds from a FastAPI 422 body. By default a field maps to the input with a
 * matching id/name, or the modal-prefixed `#m-<field>`; pass `resolve(field)`
 * to override. Returns true if it placed at least one error, so callers can
 * skip the generic toast:
 *
 *   catch (e) { if (!applyServerErrors(box, e)) toast(e.message, 'error'); }
 */
export function applyServerErrors(root, err, resolve) {
  const fields = err && err.fields;
  if (!root || !fields) return false;
  let placed = false;
  for (const [name, message] of Object.entries(fields)) {
    const dash = name.replace(/_/g, '-'); // forms often id fields with hyphens
    const input = resolve
      ? resolve(name)
      : (root.querySelector(`#${CSS.escape(name)}`)
        || root.querySelector(`[name="${CSS.escape(name)}"]`)
        || root.querySelector(`#m-${CSS.escape(name)}`)
        || root.querySelector(`#m-${CSS.escape(dash)}`)
        || root.querySelector(`#${CSS.escape(dash)}`));
    if (input) { setFieldError(input, message); placed = true; }
  }
  return placed;
}
