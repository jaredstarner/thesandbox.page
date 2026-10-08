// Fake windows that open inside the page, never as real ones, and the landing page behind every ad.

import { pick, rand, type Hell } from './_hell';
import { sfx } from './_sound';

interface WindowOptions {
  title: string;
  color: string;
  body: string;
  small?: boolean;
  /** Where to put it, as fractions of the free space; random when omitted. */
  at?: [number, number];
  onAction?: (action: string, win: HTMLElement, button: HTMLElement) => void;
  onClose?: () => void;
}

let layer: HTMLElement | null = null;
let top = 0;

export function initWindows(hell: Hell): void {
  layer = hell.root.querySelector<HTMLElement>('[data-popups]');
}

export function closeAllWindows(): void {
  layer?.replaceChildren();
}

export function openWindow(hell: Hell, opts: WindowOptions): HTMLElement | null {
  if (!layer) return null;
  // Six at a time is plenty of hell; the oldest gives way.
  const open = layer.querySelectorAll('.win');
  if (open.length >= 6) open[0].remove();

  const win = document.createElement('section');
  win.className = opts.small ? 'win win-small' : 'win';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', opts.title);
  win.style.setProperty('--win', opts.color);
  win.innerHTML =
    `<header class="win-bar"><span class="win-title">${opts.title}</span>` +
    `<button type="button" class="win-x" aria-label="Close">×</button></header>` +
    `<div class="win-body">${opts.body}</div>` +
    `<p class="win-fine">An invented ad. Nothing was bought, charged, or sent.</p>`;
  layer.append(win);

  const w = win.offsetWidth;
  const h = win.offsetHeight;
  const [fx, fy] = opts.at ?? [rand(0.1, 0.9), rand(0.15, 0.85)];
  const freeX = Math.max(0, innerWidth - w - 16);
  const freeY = Math.max(0, innerHeight - h - 60);
  let x = 8 + freeX * fx;
  let y = 52 + freeY * fy;
  const place = () => {
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  };
  place();
  raise(win);

  const close = () => {
    win.remove();
    opts.onClose?.();
  };

  win.addEventListener('pointerdown', () => raise(win));
  win.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.win-x')) {
      hell.stats.closed++;
      close();
      return;
    }
    const button = target.closest<HTMLElement>('[data-l]');
    if (!button) return;
    if (button.dataset.l === 'close') {
      close();
      return;
    }
    opts.onAction?.(button.dataset.l ?? '', win, button);
  });

  // Drag by the title bar.
  const bar = win.querySelector<HTMLElement>('.win-bar');
  bar?.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.win-x')) return;
    const sx = e.clientX - x;
    const sy = e.clientY - y;
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    const move = (ev: PointerEvent) => {
      x = Math.min(Math.max(ev.clientX - sx, -w + 60), innerWidth - 60);
      y = Math.min(Math.max(ev.clientY - sy, 44), innerHeight - 40);
      place();
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  hell.stats.windows++;
  sfx('pop');
  return win;
}

function raise(win: HTMLElement) {
  win.style.zIndex = String(++top);
}

const setBody = (win: HTMLElement, html: string) => {
  const body = win.querySelector('.win-body');
  if (body) body.innerHTML = html;
};

// ---------- Landing pages ----------

interface Landing {
  title: string;
  color: string;
  see?: string[];
  body: string;
  act?: (action: string, win: HTMLElement, hell: Hell, button: HTMLElement) => void;
}

const SLIDES = [
  'Sourdough. It has a starter. The starter has a name.',
  'Rye. Dense, dark, and a good listener.',
  'Brioche. Basically cake in a trench coat.',
  'A photo of a baguette.',
  'Focaccia. Bread that went to art school.',
  'Pumpernickel. Say it out loud. Feel better.',
  'Toast. Technically bread. Emotionally a lifestyle.',
];

const slide = (n: number) =>
  `<p class="l-kicker">You won't believe number 4</p>` +
  `<div class="l-slide" style="--hue:${(n * 47) % 360}"><span>${n}</span></div>` +
  `<p>${n <= SLIDES.length ? `${n}. ${SLIDES[n - 1]}` : `${n}. This list had seven breads in it. Keep going anyway.`}</p>` +
  `<div class="l-row"><span class="l-small">Page ${n} of 47</span><button type="button" class="l-btn" data-l="next">Next ›</button></div>`;

const CART = (planNote: string) =>
  `<table class="l-cart"><tbody>` +
  `<tr><td>CRUMBTRONIC 3000</td><td>FREE*</td></tr>` +
  `<tr><td>Shipping &amp; handling</td><td>$79.99</td></tr>` +
  `<tr><td>Toast Protection Plan <span class="l-tag">${planNote}</span> <button type="button" class="l-link" data-l="remove">remove</button></td><td>$14.99/mo</td></tr>` +
  `<tr><td>Crumb conversion fee</td><td>$4.99</td></tr>` +
  `<tr class="l-total"><td>Total today</td><td>$99.97</td></tr>` +
  `</tbody></table>` +
  `<p class="l-small">*Free with purchase.</p>` +
  `<button type="button" class="l-btn" data-l="checkout">Complete my FREE order</button>`;

const LANDINGS: Record<string, () => Landing> = {
  loafly: () => ({
    title: 'LOAFLY',
    color: '#c4520c',
    see: ['hidden-subscription', 'hard-to-cancel'],
    body:
      `<p class="l-big">🎉 Your free trial has started!</p>` +
      `<p>Your first loaf leaves the oven in six hours. After seven days your plan renews at <b>$29.99 a week</b>, billed daily.</p>` +
      `<p class="l-small">To cancel, call the Loaf Line between 3:00 and 3:05 a.m. on a weekday ending in "y". Have your loaf number ready. Your loaf number is printed on the loaf.</p>` +
      `<div class="l-row"><button type="button" class="l-ghost" data-l="cancel">Cancel my trial</button><button type="button" class="l-btn" data-l="more">Add a second loaf</button></div>`,
    act(action, win) {
      if (action === 'more') {
        setBody(win, `<p class="l-big">Two loaves every six hours!</p><p>Added. You can remove it by calling the Loaf Line.</p>`);
      } else if (action === 'cancel') {
        setBody(
          win,
          `<p class="l-big">Are you sure?</p><p>If you cancel, you'll lose access to bread.</p>` +
            `<div class="l-row"><button type="button" class="l-btn" data-l="close">Keep my bread</button><button type="button" class="l-ghost" data-l="why">Continue cancelling</button></div>`,
        );
      } else if (action === 'why') {
        setBody(
          win,
          `<p class="l-big">Why are you leaving?</p>` +
            `<div class="l-col"><button type="button" class="l-ghost" data-l="done">Too much bread</button><button type="button" class="l-ghost" data-l="done">Not enough bread</button><button type="button" class="l-ghost" data-l="done">Other (please call)</button></div>`,
        );
      } else if (action === 'done') {
        setBody(win, `<p class="l-big">Request received.</p><p>A loaf specialist will call you between 3:00 and 3:05 a.m. Please be by the phone.</p>`);
      }
    },
  }),
  crumbtronic: () => ({
    title: 'CRUMBTRONIC 3000 · Your cart',
    color: '#b30000',
    see: ['hidden-costs', 'sneaking'],
    body: CART('added for you'),
    act(action, win) {
      if (action === 'remove') setBody(win, CART('re-added for your protection'));
      else if (action === 'checkout') setBody(win, `<p class="l-big">Checkout is closed.</p><p>It was never open.</p>`);
    },
  }),
  recipejumper: () => ({
    title: 'RecipeJumper™',
    color: '#1fa83f',
    body:
      `<p class="l-big">Jump to recipes 10× faster!</p><p>RecipeJumper finds the recipe on any page, then shows you an ad for it.</p>` +
      `<div class="l-row"><button type="button" class="l-btn" data-l="install">Install the app</button><button type="button" class="l-ghost" data-l="close">Continue in browser</button></div>`,
    act(action, win) {
      if (action !== 'install') return;
      setBody(win, `<p class="l-big">Installing…</p><div class="l-progress"><i></i></div><p class="l-small" data-pct>0%</p>`);
      const bar = win.querySelector<HTMLElement>('.l-progress i');
      const pct = win.querySelector<HTMLElement>('[data-pct]');
      let p = 0;
      const timer = setInterval(() => {
        if (!win.isConnected) return clearInterval(timer);
        p = Math.min(99, p + Math.max(1, Math.round((99 - p) / 6)));
        if (bar) bar.style.width = `${p}%`;
        if (pct) pct.textContent = `${p}%`;
        if (p >= 99) {
          clearInterval(timer);
          setTimeout(() => {
            if (pct) pct.textContent = '99%. Just kidding: there is no app. The recipe is at the bottom of the page.';
          }, 1600);
        }
      }, 220);
    },
  }),
  filewizard: () => {
    const steps = [
      `<p class="l-big">Your download is ready!</p><button type="button" class="l-btn l-huge" data-l="dl">⬇ DOWNLOAD</button><p class="l-small">recipe.pdf · 4 KB</p>`,
      `<p class="l-big">Almost there!</p><p>To open recipe.pdf you need FileWizard.</p><button type="button" class="l-btn l-huge" data-l="dl">⬇ DOWNLOAD FILEWIZARD</button><p class="l-small">filewizard.exe · 212 MB</p>`,
      `<p class="l-big">One more step!</p><p>To install FileWizard you need the FileWizard Installer.</p><button type="button" class="l-btn l-huge" data-l="dl">⬇ DOWNLOAD INSTALLER</button><p class="l-small">installer-for-filewizard.exe · 3 GB</p>`,
      `<p class="l-big">There is no file.</p><p>There was never a file. Nothing was downloaded.</p>`,
    ];
    let i = 0;
    return {
      title: 'FileWizard Download Center',
      color: '#1769e0',
      body: steps[0],
      act(action, win) {
        if (action === 'dl' && i < steps.length - 1) setBody(win, steps[++i]);
      },
    };
  },
  clickwell: () => {
    let n = 1;
    return {
      title: 'Clickwell · Slideshow',
      color: '#222',
      body: slide(1),
      act(action, win) {
        if (action === 'next') setBody(win, slide(++n));
      },
    };
  },
  spoon: () => ({
    title: 'ONE WEIRD SPOON',
    color: '#ff1fa6',
    body:
      `<p class="l-big">This spoon has been banned from three kitchens.</p><p>Find out why in our 47-minute video.</p>` +
      `<button type="button" class="l-btn" data-l="watch">▶ Watch now</button>`,
    act(action, win) {
      if (action === 'watch') setBody(win, `<p class="l-big">Video unavailable.</p><p>This video isn't available in your region. Your region is your kitchen.</p>`);
    },
  }),
  granite: () => ({
    title: 'GRANITE',
    color: '#2a2d31',
    body:
      `<p class="l-big">Smell like a countertop.</p><p>Choose your finish:</p>` +
      `<div class="l-row"><button type="button" class="l-ghost" data-l="oos">Polished</button><button type="button" class="l-ghost" data-l="oos">Honed</button><button type="button" class="l-ghost" data-l="oos">Leathered</button></div>`,
    act(action, win) {
      if (action === 'oos') setBody(win, `<p class="l-big">Out of stock.</p><p>Until it's back, stand near your countertop.</p>`);
    },
  }),
  snoozle: () => ({
    title: 'SNOOZLE · Find my firmness',
    color: '#5b4bd1',
    body:
      `<p class="l-big">How do you sleep?</p>` +
      `<div class="l-col"><button type="button" class="l-ghost" data-l="firm">On my back</button><button type="button" class="l-ghost" data-l="firm">On my side</button><button type="button" class="l-ghost" data-l="firm">I don't</button></div>`,
    act(action, win) {
      if (action === 'firm') setBody(win, `<p class="l-big">Your ideal firmness is: GRANITE.</p><p>Have you considered a countertop?</p>`);
    },
  }),
  breadcoin: () => ({
    title: 'BREADCOIN Exchange',
    color: '#0e6b4a',
    body:
      `<p class="l-big">1 BRC = 1 slice*</p><p class="l-small">*Slice thickness varies. Bread may go stale. Past toast is no guarantee of future toast.</p>` +
      `<button type="button" class="l-btn" data-l="buy">Buy 100 BRC</button>`,
    act(action, win) {
      if (action === 'buy') setBody(win, `<p class="l-big">▼ 99%</p><p>While you read this, BREADCOIN fell 99%. It's a great time to buy.</p>`);
    },
  }),
  slouchmore: () => ({
    title: 'Slouchmore',
    color: '#4f7a6a',
    see: ['retargeting'],
    body:
      `<p class="l-big">It's still here.</p><p>The Slouchmore is back in stock, just for you, the way it was yesterday, and the day before.</p>` +
      `<button type="button" class="l-btn" data-l="cart">Add to cart</button>`,
    act(action, win) {
      if (action === 'cart') setBody(win, `<p class="l-big">Already there.</p><p>It's been in your cart since 2019.</p>`);
    },
  }),
  sokkit: () => ({
    title: 'SOKKIT',
    color: '#ff2e63',
    body: `<p class="l-big">Pair your socks</p><p>SOKKIT pairs with your phone. Then with each other.</p><button type="button" class="l-btn" data-l="pair">Start pairing</button>`,
    act(action, win) {
      if (action === 'pair') setBody(win, `<p class="l-big">Pairing…</p><p>Left sock: found.<br />Right sock: searching.</p>`);
    },
  }),
  quiz: () => ({
    title: 'Which toast are you?',
    color: '#ff8a00',
    body:
      `<p class="l-big">Question 1 of 30</p><p>Pick a cloud:</p>` +
      `<div class="l-row"><button type="button" class="l-ghost" data-l="q">☁️</button><button type="button" class="l-ghost" data-l="q">☁️</button><button type="button" class="l-ghost" data-l="q">☁️</button></div>`,
    act(action, win) {
      if (action === 'q') setBody(win, `<p class="l-big">You are: toast.</p><p>Share your result to see your result.</p>`);
    },
  }),
};

export function openLanding(hell: Hell, brand: string): void {
  const landing = (LANDINGS[brand] ?? LANDINGS.clickwell)();
  landing.see?.forEach((id) => hell.see(id));
  openWindow(hell, {
    title: landing.title,
    color: landing.color,
    body: landing.body,
    onAction: (action, win, button) => landing.act?.(action, win, hell, button),
  });
}

// ---------- The bagel prize ----------

let crumbs = 0;
let streak = 0;

const prize = () =>
  `<p class="l-big">YOU WON ${crumbs.toLocaleString('en-US')} CRUMBS! 🥯</p>` +
  `<p>That's ${Math.min(100, Math.round((crumbs / 12500) * 100))}% of a FREE* toaster. Bonk again to double your Crumbs!</p>` +
  `<p class="l-streak">🔥 Streak: ${streak}</p>` +
  `<div class="l-row"><button type="button" class="l-btn" data-l="again">Bonk again (×2)</button><button type="button" class="l-ghost" data-l="redeem">Redeem my Crumbs</button></div>` +
  `<p class="l-small">Crumbs have no cash value. Neither does anything else here.</p>`;

export function openPrize(hell: Hell): void {
  crumbs = crumbs ? crumbs * 2 : 500;
  streak++;
  hell.see('currency-confusion');
  if (streak > 1) hell.see('addictive-design');
  sfx('coin');
  openWindow(hell, {
    title: 'BONK THE BAGEL · Winner!',
    color: '#1f3cff',
    body: prize(),
    at: [0.5, 0.35],
    onAction(action, win) {
      if (action === 'again') {
        crumbs *= 2;
        streak++;
        hell.see('addictive-design');
        sfx('coin');
        setBody(win, prize());
      } else if (action === 'redeem') {
        win.remove();
        openLanding(hell, 'crumbtronic');
      }
    },
  });
}

// ---------- The survey pop-up ----------

const SURVEY: [string, string, string][] = [
  ['How do you feel about toast?', 'I love it', 'I really love it'],
  ['Which do you prefer?', 'Toast', 'Also toast'],
  ['Would you recommend toast to a friend?', 'Yes', 'Absolutely'],
];

export function openSurvey(hell: Hell): void {
  let q = -1;
  let spawned = false;
  const body = () =>
    q < 0
      ? `<p class="l-big">Quick question! 🎁</p><p>Take our 3-question survey for a chance to win a <b>$500 gift card</b>*.</p><button type="button" class="l-btn" data-l="go">Start the survey</button><p class="l-small">*Gift card is a picture of a gift card.</p>`
      : q < SURVEY.length
        ? `<p class="l-kicker">Question ${q + 1} of 3</p><p class="l-big">${SURVEY[q][0]}</p><div class="l-row"><button type="button" class="l-ghost" data-l="go">${SURVEY[q][1]}</button><button type="button" class="l-ghost" data-l="go">${SURVEY[q][2]}</button></div>`
        : `<p class="l-big">Congratulations!</p><div class="l-gift">GIFT CARD<b>$500</b></div><p class="l-small">This is a picture of a gift card.</p>`;
  hell.see('popup');
  openWindow(hell, {
    title: 'Toastmonger Reader Survey',
    color: '#7a3cff',
    body: body(),
    at: [0.5, 0.4],
    onAction(action, win) {
      if (action !== 'go') return;
      q++;
      if (q >= SURVEY.length) sfx('ding');
      setBody(win, body());
    },
    onClose() {
      // Close the pop-up, get two.
      if (spawned || q >= SURVEY.length || hell.blocked) return;
      spawned = true;
      openWindow(hell, {
        title: 'Wait!',
        color: '#e3121b',
        small: true,
        at: [0.2, 0.3],
        body: `<p class="l-big">You were so close!</p><p>Only 3 questions stand between you and a picture of a gift card.</p>`,
      });
      openWindow(hell, {
        title: 'Are you sure? 🎁',
        color: '#7a3cff',
        small: true,
        at: [0.8, 0.6],
        body: `<p>People who closed this survey also closed: this survey.</p>`,
      });
    },
  });
}

export function openReward(hell: Hell): void {
  hell.see('popup');
  openWindow(hell, {
    title: 'A little treat',
    color: '#b30000',
    at: [pick([0.15, 0.85]), 0.3],
    body:
      `<p class="l-big">You've been reading for over a minute!</p><p>That deserves a reward. And the reward is a toaster.</p>` +
      `<button type="button" class="l-btn" data-l="shop">Treat myself</button>`,
    onAction(action, win) {
      if (action !== 'shop') return;
      win.remove();
      hell.adClick('crumbtronic');
    },
  });
}
