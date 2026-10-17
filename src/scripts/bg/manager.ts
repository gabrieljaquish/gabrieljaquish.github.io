// Interactive page background. The visitor picks one from the header; the choice is kept in
// localStorage (a convenience only: everything works without it). Each background is its own
// lazily loaded module, so visitors only download the one they're looking at.

import type { Background, BackgroundOptions } from './types';

// Option labels live in the <select> in Base.astro.
const BACKGROUNDS = {
  soundings: () => import('./soundings.js'),
  drafting: () => import('./drafting.js'),
  radio: () => import('./radio.js'),
  grain: () => import('./grain.js'),
} as const;

type BackgroundId = keyof typeof BACKGROUNDS;
type Choice = BackgroundId | 'off';

const DEFAULT: Choice = 'soundings';
const STORAGE_KEY = 'gj.bg';

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

let current: Background | null = null;
// Guards against a slow import finishing after the visitor has already picked something else.
let generation = 0;

function isChoice(value: unknown): value is Choice {
  return value === 'off' || (typeof value === 'string' && value in BACKGROUNDS);
}

function readChoice(): Choice {
  const attr = document.documentElement.getAttribute('data-bg');
  return isChoice(attr) ? attr : DEFAULT;
}

function saveChoice(choice: Choice) {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private mode or blocked storage: the choice just won't persist.
  }
}

// Colors come from the CSS custom properties for the active background, so the stylesheet is
// the single source of truth for both the page and the canvas.
function readPalette(): BackgroundOptions['palette'] {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return { bg: get('--bg'), ink: get('--text'), accent: get('--accent'), faint: get('--faint') };
}

function contentColumn() {
  const main = document.querySelector('main');
  const rect = main?.getBoundingClientRect();
  return rect ? { left: rect.left, right: rect.right } : { left: 0, right: 0 };
}

function replaceCanvas(): HTMLCanvasElement | null {
  const old = document.getElementById('bg-canvas');
  if (!(old instanceof HTMLCanvasElement)) return null;
  // A fresh element gives each background a clean context (2D state, size, listeners).
  const fresh = old.cloneNode(false) as HTMLCanvasElement;
  old.replaceWith(fresh);
  return fresh;
}

async function mount(choice: Choice) {
  const myGeneration = ++generation;
  current?.destroy();
  current = null;

  const canvas = replaceCanvas();
  if (!canvas || choice === 'off') return;

  try {
    const module = await BACKGROUNDS[choice]();
    if (myGeneration !== generation) return;
    current = module.mount(canvas, {
      isDark: darkQuery.matches,
      reducedMotion: motionQuery.matches,
      palette: readPalette(),
      column: contentColumn,
    });
  } catch (error) {
    // A background is decoration; never let it break the page.
    console.warn('Background failed to load', error);
  }
}

function setChoice(choice: Choice) {
  document.documentElement.setAttribute('data-bg', choice);
  saveChoice(choice);
  void mount(choice);
}

function initPicker() {
  const select = document.getElementById('bg-select');
  if (!(select instanceof HTMLSelectElement)) return;
  select.value = readChoice();
  select.addEventListener('change', () => {
    if (isChoice(select.value)) setChoice(select.value);
  });
  select.closest('[hidden]')?.removeAttribute('hidden');
}

initPicker();
void mount(readChoice());
darkQuery.addEventListener('change', () => void mount(readChoice()));
motionQuery.addEventListener('change', () => void mount(readChoice()));
