import type { Lab, Program } from './_lab';

// One SVG file with its own animation, handed to the browser once. Whether
// the tab animates it is up to the browser; no script runs after this.

type Kind = 'css' | 'smil';

const TILE = '<rect width="32" height="32" rx="6" fill="#16120c"/>';

const FILES: Record<Kind, string> = {
  css:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>' +
    '@keyframes s{to{transform:rotate(360deg)}}@keyframes b{50%{transform:scale(.4)}}' +
    '.r{transform-origin:16px 16px;animation:s 1.6s linear infinite}' +
    '.d{transform-origin:16px 16px;animation:b .8s ease-in-out infinite}</style>' +
    TILE +
    '<rect class="r" x="8" y="8" width="16" height="16" rx="2" fill="#ffb000"/>' +
    '<circle class="d" cx="16" cy="16" r="4" fill="#16120c"/></svg>',
  smil:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    TILE +
    '<circle cx="16" cy="16" r="9.5" fill="none" stroke="#2e2210" stroke-width="3"/>' +
    '<circle cx="16" cy="6.5" r="4" fill="#ffb000">' +
    '<animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="1.2s" repeatCount="indefinite"/>' +
    '</circle></svg>',
};

const NAMES: Record<Kind, string> = { css: 'CSS animation', smil: 'SMIL animation' };

export function createNative(lab: Lab): Program {
  const panel = lab.panel('native');
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-native]')];
  let kind: Kind = 'css';

  const show = () => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.native === kind));
    lab.showImage(`data:image/svg+xml,${encodeURIComponent(FILES[kind])}`, 'image/svg+xml', true);
    lab.title(`Native · ${NAMES[kind]}`);
  };

  const onPick = (event: Event) => {
    kind = (event.currentTarget as HTMLElement).dataset.native === 'smil' ? 'smil' : 'css';
    show();
  };

  return {
    start() {
      show();
      for (const b of buttons) b.addEventListener('click', onPick);
    },
    stop() {
      for (const b of buttons) b.removeEventListener('click', onPick);
    },
  };
}
