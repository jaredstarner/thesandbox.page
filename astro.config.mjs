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
  ],
});
