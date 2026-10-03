// Night is the default theme; a visitor's choice is remembered in localStorage.
// src/layouts/Base.astro applies the stored theme before first paint.

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'theme';

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked; the theme still applies for this page view.
  }
}
