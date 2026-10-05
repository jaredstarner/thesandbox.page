// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://thesandbox.page',
  // Fonts are downloaded at build time and served from the site itself.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Fraunces',
      cssVariable: '--font-display',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    // The /experiments/ register's three voices; only that page loads them.
    {
      provider: fontProviders.fontsource(),
      name: 'Archivo Narrow',
      cssVariable: '--font-register-form',
      weights: [500, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Arial Narrow', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-register-data',
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
    {
      // A weight range selects the variable files, which carry the opsz axis too.
      provider: fontProviders.fontsource(),
      name: 'Source Serif 4',
      cssVariable: '--font-register-entry',
      weights: ['200 900'],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      // The split-flap face on /arrivals/.
      provider: fontProviders.fontsource(),
      name: 'Roboto Condensed',
      cssVariable: '--font-flap',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext', 'cyrillic', 'greek', 'vietnamese'],
      fallbacks: ['Arial Narrow', 'Arial', 'sans-serif'],
    },
    // The home page's survey map: a face drawn from US highway signage, and its mono.
    {
      provider: fontProviders.fontsource(),
      name: 'Overpass',
      cssVariable: '--font-survey',
      weights: ['100 900'],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Arial Narrow', 'Arial', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Overpass Mono',
      cssVariable: '--font-survey-mono',
      weights: ['300 700'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
    {
      // The pixel labels on /favicon-lab/.
      provider: fontProviders.fontsource(),
      name: 'Silkscreen',
      cssVariable: '--font-iconlab',
      weights: [400, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
  ],
});
