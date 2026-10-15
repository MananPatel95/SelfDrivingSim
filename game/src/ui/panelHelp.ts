/**
 * ? help popovers for HUD panels.
 * No full-screen overlay — driving keys and canvas clicks stay live.
 */

import { panelHelpCopy, type CameraMode, type PanelHelpId, type StackProfile } from './viewCopy';

export const HUD_HELP_POPOVER_ID = 'hud-help-popover';

export type HelpCopyFn = (id: PanelHelpId) => { title: string; body: string };

let copyFn: HelpCopyFn = (id) => panelHelpCopy(id, 'tesla', 'chase');
let openId: PanelHelpId | null = null;
let popover: HTMLElement | null = null;
let boundRoot: ParentNode | null = null;
let listening = false;

function ensurePopover(doc: Document): HTMLElement {
  let el = doc.getElementById(HUD_HELP_POPOVER_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = HUD_HELP_POPOVER_ID;
    el.className = 'hud-help-popover hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Panel help');
    doc.body.appendChild(el);
  }
  popover = el;
  return el;
}

/** Keep help copy under the F1/F2/F3 switcher (top ~10px + ~48px + gap). */
export const VIEW_SWITCHER_GAP = 8;
export const VIEW_SWITCHER_FALLBACK_BOTTOM = 58;

export function popoverMinTop(doc: Document): number {
  const tabs = doc.getElementById('view-switcher');
  if (tabs instanceof HTMLElement) {
    const bottom = tabs.getBoundingClientRect().bottom;
    if (bottom > 0) return Math.ceil(bottom) + VIEW_SWITCHER_GAP;
  }
  return VIEW_SWITCHER_FALLBACK_BOTTOM + VIEW_SWITCHER_GAP;
}

function placePopover(anchor: HTMLElement, el: HTMLElement): void {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const vw = view?.innerWidth ?? 1280;
  const vh = view?.innerHeight ?? 720;
  const panel = anchor.closest('.hud-panel');
  const r = (panel instanceof HTMLElement ? panel : anchor).getBoundingClientRect();
  const pw = Math.min(280, Math.max(180, vw - 16));
  el.style.width = `${pw}px`;
  const minTop = popoverMinTop(doc);
  const ph = Math.min(el.offsetHeight || 160, Math.max(80, vh - minTop - 8));
  let left = r.left - pw - 8;
  if (left < 8) left = Math.min(vw - pw - 8, r.right + 8);
  left = Math.max(8, Math.min(left, vw - pw - 8));
  let top = Math.max(r.top, minTop);
  if (top + ph > vh - 8) top = Math.max(minTop, vh - ph - 8);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function render(id: PanelHelpId, anchor: HTMLElement | null): void {
  if (!popover) return;
  const copy = copyFn(id);
  popover.replaceChildren();
  const title = popover.ownerDocument.createElement('div');
  title.className = 'hud-help-title';
  title.textContent = copy.title;
  const body = popover.ownerDocument.createElement('div');
  body.className = 'hud-help-body';
  body.textContent = copy.body;
  popover.append(title, body);
  popover.classList.remove('hidden');
  popover.dataset['help'] = id;
  if (anchor) placePopover(anchor, popover);
}

export function panelHelpIsOpen(): boolean {
  return openId !== null;
}

export function dismissPanelHelp(): boolean {
  if (!openId) return false;
  openId = null;
  popover?.classList.add('hidden');
  if (popover) delete popover.dataset['help'];
  return true;
}

export function refreshPanelHelp(): void {
  if (!openId || !popover) return;
  const btn = boundRoot?.querySelector?.(`.hud-panel-help[data-help="${openId}"]`) as HTMLElement | null;
  render(openId, btn);
}

function onDocumentPointerDown(ev: Event): void {
  if (!openId) return;
  const t = ev.target;
  if (!(t instanceof Node)) return;
  if (popover?.contains(t)) return;
  if (t instanceof Element && t.closest('.hud-panel-help')) return;
  dismissPanelHelp();
}

function onDocumentKeydown(ev: Event): void {
  if (!openId) return;
  const key = (ev as KeyboardEvent).key;
  if (key !== 'Escape') return;
  ev.preventDefault();
  dismissPanelHelp();
}

function bindListeners(doc: Document): void {
  if (listening) return;
  listening = true;
  doc.addEventListener('pointerdown', onDocumentPointerDown, true);
  doc.addEventListener('keydown', onDocumentKeydown, true);
}

export function openPanelHelp(id: PanelHelpId, anchor: HTMLElement): void {
  const doc = anchor.ownerDocument;
  ensurePopover(doc);
  bindListeners(doc);
  if (openId === id) {
    dismissPanelHelp();
    return;
  }
  openId = id;
  render(id, anchor);
  if (typeof anchor.blur === 'function') anchor.blur();
}

export function bindPanelHelp(
  root: ParentNode,
  opts: { copy?: HelpCopyFn; stack?: StackProfile; camera?: CameraMode } = {},
): void {
  boundRoot = root;
  const doc = (root as Document).defaultView
    ? (root as Document)
    : ((root as HTMLElement).ownerDocument ?? globalThis.document);
  copyFn = opts.copy ?? ((id) => panelHelpCopy(id, opts.stack ?? 'tesla', opts.camera ?? 'chase'));
  ensurePopover(doc);
  bindListeners(doc);
  root.querySelectorAll('.hud-panel-help').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = (btn as HTMLElement).dataset['help'] as PanelHelpId | undefined;
      if (!id) return;
      openPanelHelp(id, btn as HTMLElement);
    });
  });
}

export function setPanelHelpCopy(fn: HelpCopyFn): void {
  copyFn = fn;
  refreshPanelHelp();
}
