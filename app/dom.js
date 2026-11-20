// Petits outils DOM. Les données ne passent jamais par innerHTML : tout est inséré en texte.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function svgCheck() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'ds-check');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 12.5l5 5L20 6.5');
  svg.append(path);
  return svg;
}

export const dot = (color) => h('span', { class: 'dot', style: `background: var(--ds-${color})` });

/** Fenêtre modale. Renvoie { dialog, close, body } ; le contenu peut être remplacé via body.replaceChildren. */
export function modal(...children) {
  const body = h('div', { class: 'sheet' }, ...children);
  const dialog = h('dialog', { class: 'sheet-dialog' }, body);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, close: () => dialog.close() };
}

let toastTimer;
/** Confirmation d'action : coche qui se dessine + libellé. */
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast ds-text', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.replaceChildren(svgCheck(), h('span', null, message));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function field({ label, name, type = 'text', value = '', required, autocomplete, hint, attrs = {} }) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  return h('div', { class: 'field-row' },
    h('label', { class: 'ds-label', for: id }, label),
    h('input', { class: 'field', id, name, type, value, required, autocomplete: autocomplete || 'off', ...attrs }),
    hint ? h('p', { class: 'ds-caption ds-muted' }, hint) : null);
}

export const errorLine = () => h('p', { class: 'error ds-caption', role: 'alert' });

export function busy(button, label) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => { button.disabled = false; button.textContent = original; };
}

export function readFile(file) {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}
