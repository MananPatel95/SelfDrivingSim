/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bindPanelHelp, dismissPanelHelp, HUD_HELP_POPOVER_ID, panelHelpIsOpen, popoverMinTop } from './panelHelp';
import { PANEL_WIDTH } from './hudPanels';

const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

function styleBlock(): string {
  const start = INDEX_HTML.indexOf('<style>');
  const end = INDEX_HTML.indexOf('</style>');
  return INDEX_HTML.slice(start, end);
}

function rightStackHtml(): string {
  const start = INDEX_HTML.indexOf('<div id="top-right-stack"');
  const end = INDEX_HTML.indexOf('<button id="decision-banner"');
  return INDEX_HTML.slice(start, end);
}

function mountPanels(): HTMLElement {
  document.body.innerHTML = rightStackHtml();
  const stack = document.getElementById('top-right-stack')!;
  stack.querySelectorAll('.hud-panel').forEach((el) => {
    (el as HTMLElement).style.width = `${PANEL_WIDTH}px`;
  });
  bindPanelHelp(stack, { stack: 'waabi', camera: 'chase' });
  return stack;
}

afterEach(() => {
  dismissPanelHelp();
  document.body.innerHTML = '';
});

describe('HUD panel DOM', () => {
  it('declares one shared width for every right-side panel', () => {
    const css = styleBlock();
    expect(css).toContain('--hud-panel-width: min(300px, calc(100vw - 24px))');
    expect(css).toMatch(/\.hud-panel\s*\{[^}]*width:\s*var\(--hud-panel-width\)/s);
    expect(css).not.toMatch(/#view-explainer\s*\{[^}]*width:\s*min\(360px/s);
    expect(css).not.toMatch(/#ai-view-panel\s*\{[^}]*width:\s*min\(440px/s);
    expect(css).not.toMatch(/#bev-overlay\s*\{[^}]*width:\s*min\(420px/s);
    expect(css).not.toMatch(/#info-card\s*\{[^}]*width:\s*min\(350px/s);
  });

  it('puts a ? button on every F1/F2/F3 panel and strips long explainer prose', () => {
    const stack = rightStackHtml();
    for (const id of ['explainer', 'ai-view', 'info', 'bev']) {
      expect(stack).toContain(`data-help="${id}"`);
    }
    expect(stack).toContain('id="view-explainer-uses"');
    expect(stack).not.toContain('Unlike the others');
    expect(stack).not.toContain('id="view-explainer-diff"');
    expect(stack).not.toContain('id="camera-explainer-uses"');
    expect(stack).toContain('data-panel="bev"');
  });

  it('gives mounted panels equal widths and one right edge', () => {
    const stack = mountPanels();
    const panels = [...stack.querySelectorAll<HTMLElement>('.hud-panel')];
    expect(panels.length).toBeGreaterThanOrEqual(3);
    const widths = new Set(panels.map((p) => p.style.width));
    expect(widths).toEqual(new Set([`${PANEL_WIDTH}px`]));
    expect(document.querySelectorAll('.hud-panel-help').length).toBe(4);
  });

  it('opens a ? popover and closes on click-outside and Esc without a blocking overlay', () => {
    const stack = mountPanels();
    const help = stack.querySelector<HTMLButtonElement>('.hud-panel-help[data-help="explainer"]')!;
    help.click();
    expect(panelHelpIsOpen()).toBe(true);
    const pop = document.getElementById(HUD_HELP_POPOVER_ID)!;
    expect(pop.classList.contains('hidden')).toBe(false);
    expect(pop.textContent).toMatch(/Lidar, cameras, and radar/);
    expect(pop.textContent).toMatch(/Unlike the others/);
    expect(document.querySelector('.hud-help-backdrop')).toBeNull();
    expect(getComputedStyle(pop).pointerEvents).not.toBe('none');

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panelHelpIsOpen()).toBe(false);
    expect(pop.classList.contains('hidden')).toBe(true);

    help.click();
    expect(panelHelpIsOpen()).toBe(true);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(panelHelpIsOpen()).toBe(false);

    const bevHelp = stack.querySelector<HTMLButtonElement>('.hud-panel-help[data-help="bev"]')!;
    bevHelp.click();
    expect(document.getElementById(HUD_HELP_POPOVER_ID)!.textContent).toMatch(/TTC/);
    expect(document.getElementById(HUD_HELP_POPOVER_ID)!.textContent).toMatch(/\+1s/);
  });

  it('keeps the ? popover below the F1/F2/F3 tab bar', () => {
    const tabs = document.createElement('div');
    tabs.id = 'view-switcher';
    tabs.getBoundingClientRect = () =>
      ({ top: 10, bottom: 58, left: 410, right: 870, width: 460, height: 48, x: 410, y: 10, toJSON() { return {}; } }) as DOMRect;
    document.body.appendChild(tabs);
    expect(popoverMinTop(document)).toBe(66);
  });

  it('does not capture WASD while a popover is open', () => {
    const stack = mountPanels();
    stack.querySelector<HTMLButtonElement>('.hud-panel-help')!.click();
    const ev = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(panelHelpIsOpen()).toBe(true);
  });
});
