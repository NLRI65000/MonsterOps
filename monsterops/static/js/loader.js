let _count = 0;
let _el = null;

function _ensure() {
  if (_el) return;
  _el = document.createElement('div');
  _el.id = 'loading-spinner';
  document.body.appendChild(_el);
}

export function startLoading() {
  _count++;
  _ensure();
  _el.classList.add('visible');
}

export function stopLoading() {
  _count = Math.max(0, _count - 1);
  if (_count === 0 && _el) {
    _el.classList.remove('visible');
  }
}
