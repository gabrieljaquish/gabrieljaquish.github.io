// Contract every background module implements: `export function mount(canvas, options)`.

export interface BackgroundOptions {
  isDark: boolean;
  reducedMotion: boolean;
  // Hex colors read from the active CSS custom properties.
  palette: { bg: string; ink: string; accent: string; faint: string };
  // Current left/right edges of the content column in CSS px. The canvas is fixed while the
  // page scrolls, so treat the column as running the full height of the viewport.
  column: () => { left: number; right: number };
}

export interface Background {
  destroy(): void;
}

export type MountBackground = (canvas: HTMLCanvasElement, options: BackgroundOptions) => Background;
