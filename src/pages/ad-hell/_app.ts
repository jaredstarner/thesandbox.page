// Ad hell: the clock, the tally, the ad blocker, and the order things go wrong in.

import { initChat, initProof } from './_chatter';
import { clock, type Hell, type Stats } from './_hell';
import { cookieWall, initNewsletter, initPushAsk, initSticky, newsletter, postitial, prestitial, pushAsk } from './_interrupts';
import { initShift } from './_shift';
import { initAudio, setMuted, sfx } from './_sound';
import { VIOLATIONS } from './_tally';
import { initVideo } from './_video';
import { closeAllWindows, initWindows, openLanding, openPrize, openReward, openSurvey } from './_windows';

const BEST_KEY = 'adhell:best';
const CALM_WPM = 200;

export function startAdHell(root: HTMLElement): void {
  const site = root.querySelector<HTMLElement>('[data-site]');
  const box = root.querySelector<HTMLInputElement>('[data-block]');
  if (!site || !box) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);

  let blocked = box.checked;
  let blockedEver = blocked;
  let finished = false;
  let started = false;
  let jumped = false;
  const t0 = performance.now();
  let lastTick = t0;
  let adMs = 0;
  let finishMs = 0;
  const modals = new Set<string>();
  const timers: { at: number; fn: () => void }[] = [];
  const blockListeners: ((blocked: boolean) => void)[] = [];
  const seen = new Set<string>();
  const stats: Stats = {
    adClicks: 0,
    fakeCloses: 0,
    closed: 0,
    windows: 0,
    cookieClicks: 0,
    cookieOutcome: null,
    shoves: 0,
    peakDensity: 0,
    cls: null,
    blockedMs: 0,
  };

  const hud = {
    time: q('[data-stat="time"]'),
    clicks: q('[data-stat="clicks"]'),
    density: q('[data-stat="density"]'),
    cls: q('[data-stat="cls"]'),
    clsLabel: q('[data-stat-label="cls"]'),
    seen: q('[data-stat="seen"]'),
    goal: q('[data-hud-goal]'),
    flash: q('[data-hud-flash]'),
  };
  const labels = new Map(VIOLATIONS.map((v) => [v.id, v.label]));
  let flashTimer = 0;

  const hell: Hell = {
    root,
    site,
    reducedMotion,
    stats,
    get blocked() {
      return blocked;
    },
    get finished() {
      return finished;
    },
    get started() {
      return started;
    },
    adNow: () => adMs,
    at(delay, fn) {
      timers.push({ at: adMs + delay, fn });
    },
    see(id) {
      if (seen.has(id) || !labels.has(id)) return;
      seen.add(id);
      root.querySelector(`[data-check="${id}"]`)?.setAttribute('data-seen', '');
      if (hud.seen) hud.seen.textContent = String(seen.size);
      if (hud.flash && !finished) {
        hud.flash.textContent = `+ ${labels.get(id)}`;
        hud.flash.classList.remove('show');
        void hud.flash.offsetWidth;
        hud.flash.classList.add('show');
        clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => hud.flash?.classList.remove('show'), 2200);
      }
    },
    adClick(brand, fake = false) {
      stats.adClicks++;
      if (fake) {
        stats.fakeCloses++;
        hell.see('fake-close');
        sfx('buzz');
      }
      if (hud.clicks) hud.clicks.textContent = String(stats.adClicks);
      if (brand === 'bagel') openPrize(hell);
      else openLanding(hell, brand);
    },
    openModal(name) {
      modals.add(name);
      syncModal();
    },
    closeModal(name) {
      modals.delete(name);
      syncModal();
    },
    onBlock(fn) {
      blockListeners.push(fn);
    },
  };

  // While something modal is up, the page underneath is inert and does not scroll. The bar never is.
  function syncModal() {
    const locked = !blocked && modals.size > 0;
    site!.inert = locked;
    root.toggleAttribute('data-lock', locked);
  }

  initAudio();
  initWindows(hell);
  initNewsletter(hell);
  initPushAsk(hell);
  const sticky = initSticky(hell);
  const chat = initChat(hell);
  const proof = initProof(hell);
  const shift = initShift(hell);
  const video = initVideo(hell);
  if (!shift.clsSupported && hud.clsLabel) hud.clsLabel.textContent = 'Shoves';

  // ---------- The ad blocker ----------

  const goalText = hud.goal?.textContent ?? '';

  function setBlocked(on: boolean) {
    if (on) {
      // Count before the checkbox flips, while the ads are still on the page.
      const showing =
        [...root.querySelectorAll<HTMLElement>('.ad')].filter((ad) => ad.getClientRects().length > 0).length +
        root.querySelectorAll('.win').length;
      if (hud.goal && !finished) hud.goal.textContent = `Ad blocker on: ${showing} ads gone.`;
      blockedEver = true;
      closeAllWindows();
      hud.flash?.classList.remove('show');
    } else if (hud.goal && !finished) {
      hud.goal.textContent = goalText;
    }
    // Scroll anchoring is off on purpose, so keep the reader's place by hand: the first bit of
    // article text on screen stays where it is while the ads around it come and go.
    const anchor = [...root.querySelectorAll<HTMLElement>('.post > p, .post > h2, .post > .faq, .post > .card')].find(
      (el) => el.getBoundingClientRect().bottom > 60,
    );
    const before = anchor?.getBoundingClientRect().top ?? 0;
    box!.checked = on;
    blocked = on;
    root.toggleAttribute('data-blocked', on);
    if (anchor) scrollBy(0, anchor.getBoundingClientRect().top - before);
    for (const fn of blockListeners) fn(on);
    syncModal();
    video.tick();
  }

  box.addEventListener('click', (e) => {
    const next = box.checked;
    // Undo the click's own toggle and redo it inside a view transition, so the ads leave together.
    e.preventDefault();
    const apply = () => setBlocked(next);
    if (document.startViewTransition && !reducedMotion) {
      root.setAttribute('data-vt', '');
      const vt = document.startViewTransition(apply);
      vt.finished.finally(() => root.removeAttribute('data-vt'));
    } else setTimeout(apply);
  });
  if (blocked) setBlocked(true);

  q('[data-sound]')?.addEventListener('click', (e) => {
    const button = e.currentTarget as HTMLElement;
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    setMuted(!on);
  });

  // ---------- Clicks on ads ----------

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.win, .hud, .checklist, .report')) return;
    if (t.closest('[data-close-ad]')) {
      const ad = t.closest<HTMLElement>('.ad');
      if (ad) ad.hidden = true;
      stats.closed++;
      return;
    }
    if (t.closest('[data-bagel]')) {
      hell.adClick('bagel');
      return;
    }
    const cta = t.closest<HTMLElement>('[data-cta]');
    if (cta?.dataset.cta) {
      e.preventDefault();
      hell.adClick(cta.dataset.cta, !!t.closest('[data-fakex]'));
      return;
    }
    const jump = t.closest('[data-jump]');
    if (jump && started) {
      jumped = true;
      if (blocked) return;
      e.preventDefault();
      postitial(hell, () => q('#recipe')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' }));
    }
  });

  // Head for the tabs or the address bar and the newsletter pounces.
  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget || e.clientY > 6) return;
    if (!started || blocked || finished || modals.size > 0 || adMs < 6000) return;
    newsletter(hell, true);
  });

  // ---------- The scrollover, where CSS can't drive it ----------

  // The same sweep the CSS view timeline draws: the panel rises at twice the scroll speed,
  // from just below the screen to just above it, while its zero-height slot crosses the viewport.
  const sweep = q('[data-scrollover]');
  const panel = sweep?.querySelector<HTMLElement>('.scrollover-panel');
  if (sweep && panel && !CSS.supports('animation-timeline: view()')) {
    let queued = false;
    const place = () => {
      queued = false;
      const v = innerHeight;
      const y = Math.min(v, Math.max(-v, 2 * sweep.getBoundingClientRect().top - v));
      panel.style.translate = `0 ${y}px`;
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(place);
    };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    place();
  }

  // ---------- The fake deal in the rail ----------

  const urgency = q('[data-urgency]');
  const stock = q('[data-stock]');
  const watchers = q('[data-watchers]');
  let dealLeft = 299;
  let stockLeft = 3;
  setInterval(() => {
    if (finished) return;
    dealLeft--;
    if (dealLeft < 0) dealLeft = 299;
    if (urgency) urgency.textContent = dealLeft === 299 ? 'EXTENDED!' : `${clock(dealLeft * 1000).padStart(5, '0')}`;
    if (dealLeft % 7 === 0 && stock) {
      stockLeft = stockLeft <= 2 ? 3 + Math.round(Math.random()) : stockLeft - 1;
      stock.textContent = String(stockLeft);
    }
    if (dealLeft % 3 === 0 && watchers) watchers.textContent = String(12 + Math.floor(Math.random() * 20));
  }, 1000);

  // ---------- Violations seen in passing ----------

  const passing = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || blocked) continue;
        const ids = (entry.target as HTMLElement).dataset.violation ?? '';
        ids.split(' ').forEach((id) => id && hell.see(id));
        passing.unobserve(entry.target);
      }
    },
    { threshold: 0.3 },
  );

  // ---------- The clock ----------

  const large = [...root.querySelectorAll<HTMLElement>('[data-large]')];
  let ticks = 0;

  setInterval(() => {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (started && !blocked && !finished && modals.size === 0 && !document.hidden) adMs += dt;
    if (blocked && !finished) stats.blockedMs += dt;

    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at > adMs) continue;
      const [due] = timers.splice(i, 1);
      try {
        due.fn();
      } catch (err) {
        console.error(err);
      }
    }

    if (!finished && hud.time) hud.time.textContent = clock(now - t0);
    video.tick();
    shift.tick();

    if (++ticks % 4 === 0 && started && !blocked) {
      const d = shift.density();
      stats.peakDensity = Math.max(stats.peakDensity, d);
      if (hud.density) hud.density.textContent = `${Math.round(d * 100)}%`;
      if (d > 0.3) hell.see('density-30');
      if (d > 0.5) hell.see('density-50');
      if (d > 0.3 && video.pip) hell.see('density-30-sticky-video');
      if (video.pip && large.some((ad) => onScreen(ad))) hell.see('sticky-video-inline');
    }
    if (hud.cls) {
      hud.cls.textContent = shift.clsSupported ? (stats.cls == null ? '0.00' : stats.cls.toFixed(2)) : String(stats.shoves);
    }
  }, 250);

  function onScreen(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    if (!r.height) return false;
    const shown = Math.min(r.bottom, innerHeight) - Math.max(r.top, 44);
    return shown / r.height > 0.5;
  }

  // ---------- The end ----------

  const end = q('[data-end]');
  if (end) {
    new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && started && !finished) finish();
      },
      { threshold: 1 },
    ).observe(end);
  }

  function words() {
    const post = q('[data-post]');
    if (!post) return 0;
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('.ad, .comments') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n = 0;
    while (walker.nextNode()) n += (walker.currentNode.textContent ?? '').split(/\s+/).filter(Boolean).length;
    return n;
  }

  function finish() {
    finished = true;
    finishMs = performance.now() - t0;
    video.stop();
    closeAllWindows();
    sfx('ding');
    if (hud.goal) hud.goal.textContent = 'You read it.';
    report();
  }

  function report() {
    const dialog = q<HTMLDialogElement>('[data-report]');
    const list = q('[data-rp-stats]');
    const note = q('[data-rp-note]');
    if (!dialog || !list) return;
    const calm = Math.max(1, Math.round(words() / CALM_WPM));
    const rows: [string, string][] = [
      [jumped ? 'Time to the recipe' : 'Time to read it', clock(finishMs)],
      ['The same text, calmly', `about ${calm} min at ${CALM_WPM} words a minute`],
      ['Clicks on ads', String(stats.adClicks)],
      ['Close buttons that were ads', String(stats.fakeCloses)],
      ['Things you closed', String(stats.closed)],
      ['Windows that opened', String(stats.windows)],
      [
        'The cookie wall',
        stats.cookieOutcome === 'rejected'
          ? `rejected, in ${stats.cookieClicks} clicks`
          : stats.cookieOutcome === 'accepted'
            ? `accepted, in ${stats.cookieClicks} click${stats.cookieClicks === 1 ? '' : 's'} (rejecting takes 14)`
            : stats.cookieOutcome === 'partial'
              ? `half-rejected, in ${stats.cookieClicks} clicks`
              : 'never answered',
      ],
      ['Violations seen', `${seen.size} of ${VIOLATIONS.length}`],
      ['Peak ad density', `${Math.round(stats.peakDensity * 100)}% of the article`],
      shift.clsSupported
        ? ['Layout shift (CLS)', `${(stats.cls ?? 0).toFixed(2)} (0.1 or less counts as good)`]
        : ['Late ads that shoved the text', String(stats.shoves)],
    ];
    if (blockedEver) rows.push(['Ad blocker on for', clock(stats.blockedMs)]);
    list.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );

    let best: number | null = null;
    try {
      const stored = Number(localStorage.getItem(BEST_KEY));
      if (stored > 0) best = stored;
      if (!blockedEver && (best == null || finishMs < best)) localStorage.setItem(BEST_KEY, String(Math.round(finishMs)));
    } catch {
      // Storage can be off; the report doesn't need it.
    }
    if (note) {
      note.textContent = blockedEver
        ? 'You used the ad blocker, which is how most people read the web.'
        : jumped
          ? "You skipped the story and jumped to the recipe. Everyone does. Wren understands."
          : best != null && finishMs < best
          ? `A new best: your last best was ${clock(best)}.`
          : best != null
            ? `Your best is ${clock(best)}.`
            : 'All the way through, with every ad on. Respect.';
    }
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  }

  q('[data-rp-calm]')?.addEventListener('click', () => {
    q<HTMLDialogElement>('[data-report]')?.close();
    if (!blocked) setBlocked(true);
    scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  q('[data-rp-again]')?.addEventListener('click', () => location.reload());

  // ---------- The running order ----------

  const untilUnblocked = () =>
    new Promise<void>((resolve) => {
      if (!blocked) return resolve();
      hell.onBlock((on) => !on && resolve());
    });

  (async () => {
    await prestitial(hell);
    started = true;
    root.querySelectorAll('[data-violation]').forEach((el) => passing.observe(el));
    await untilUnblocked();
    await cookieWall(hell);
    hell.at(1500, sticky.rise);
    hell.at(5000, proof.show);
    hell.at(9000, chat.ping);
    hell.at(20000, () => newsletter(hell));
    hell.at(32000, () => openSurvey(hell));
    hell.at(50000, () => pushAsk(hell));
    hell.at(70000, () => openReward(hell));
  })();
}
