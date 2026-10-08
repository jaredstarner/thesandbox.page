// Everything that gets between the reader and the recipe: the prestitial, the cookie wall,
// the newsletter, the postitial, the notification pre-ask, and the sticky banner.

import type { Hell } from './_hell';
import { sfx } from './_sound';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);

// ---------- Prestitial ----------

export function prestitial(hell: Hell): Promise<void> {
  const el = $(hell.root, '[data-prestitial]');
  if (!el) return Promise.resolve();
  const count = $(el, '[data-pre-count]');
  const waitText = $(el, '[data-pre-wait]');
  const skip = $(el, '[data-pre-skip]');
  el.hidden = false;
  hell.openModal('prestitial');
  hell.see('prestitial');

  return new Promise((resolve) => {
    let n = 7;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      el.hidden = true;
      hell.closeModal('prestitial');
      resolve();
    };
    const timer = setInterval(() => {
      n--;
      if (count) count.textContent = String(n);
      if (n <= 0) {
        clearInterval(timer);
        if (waitText) waitText.hidden = true;
        if (skip) skip.hidden = false;
      }
    }, 1000);
    skip?.addEventListener('click', finish);
    // Blocking ads ends it on the spot.
    hell.onBlock((blocked) => blocked && finish());
  });
}

// ---------- Cookie wall ----------

export function cookieWall(hell: Hell): Promise<void> {
  const el = $(hell.root, '[data-cookies]');
  if (!el) return Promise.resolve();
  const steps = el.querySelectorAll<HTMLElement>('[data-cookie-step]');
  const show = (name: string) => steps.forEach((s) => (s.hidden = s.dataset.cookieStep !== name));
  el.hidden = false;
  show('main');
  hell.openModal('cookies');
  hell.see('forced-action');
  hell.see('visual-interference');

  return new Promise((resolve) => {
    const close = (outcome: 'accepted' | 'rejected' | 'partial') => {
      hell.stats.cookieOutcome = outcome;
      el.hidden = true;
      hell.closeModal('cookies');
      resolve();
    };
    el.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!button) return;
      hell.stats.cookieClicks++;
      const toggle = button.dataset.cookieToggle;
      if (toggle !== undefined) {
        const on = button.getAttribute('aria-checked') === 'true';
        button.setAttribute('aria-checked', String(!on));
        return;
      }
      if (button.dataset.cookieObject !== undefined) {
        const objected = button.getAttribute('aria-pressed') === 'true';
        button.setAttribute('aria-pressed', String(!objected));
        button.textContent = objected ? 'Object' : 'Objected';
        return;
      }
      switch (button.dataset.cookie) {
        case 'accept':
          close('accepted');
          break;
        case 'manage':
          show('purposes');
          hell.see('preselection');
          hell.see('obstruction');
          break;
        case 'legit':
          show('legit');
          break;
        case 'confirm': {
          const anyOn = el.querySelector('[data-cookie-toggle][aria-checked="true"]');
          const anyLeft = el.querySelector('[data-cookie-object][aria-pressed="false"]');
          if (anyOn || anyLeft) close('partial');
          else {
            show('sure');
            hell.see('confirmshaming');
          }
          break;
        }
        case 'reject':
          close('rejected');
          break;
      }
    });
  });
}

// ---------- Newsletter ----------

const NAGS = [
  { kicker: "WAIT! Don't go yet", title: 'Get <i>101 Toasts</i>, our free e-book', no: 'No thanks, I like my toast pale and sad.' },
  { kicker: 'Still here? So are we.', title: 'Your free e-book is getting cold', no: "No thanks, I'll just keep burning it." },
  { kicker: 'Last chance (this week)', title: 'Fine. Two free e-books.', no: 'No. I hate free e-books and joy.' },
];

let nagged = 0;
let subscribed = false;
let nagOpen = false;

export function newsletter(hell: Hell, exitIntent = false): boolean {
  const el = $(hell.root, '[data-newsletter]');
  if (!el || nagOpen || subscribed || nagged >= NAGS.length || hell.blocked || hell.finished) return false;
  const copy = NAGS[nagged++];
  const set = (sel: string, html: string) => {
    const node = $(el, sel);
    if (node) node.innerHTML = html;
  };
  set('[data-nl-kicker]', copy.kicker);
  set('[data-nl-title]', copy.title);
  set('[data-nl-no]', copy.no);
  const form = $<HTMLFormElement>(el, '[data-nl-form]');
  const thanks = $(el, '[data-nl-thanks]');
  if (form) form.hidden = false;
  if (thanks) thanks.hidden = true;
  el.hidden = false;
  nagOpen = true;
  hell.openModal('newsletter');
  sfx('whoosh');
  hell.see('confirmshaming');
  hell.see('preselection');
  hell.see('trick-wording');
  if (nagged > 1) hell.see('nagging');
  if (exitIntent) hell.see('exit-intent');
  return true;
}

export function initNewsletter(hell: Hell): void {
  const el = $(hell.root, '[data-newsletter]');
  if (!el) return;
  const close = (again: boolean) => {
    el.hidden = true;
    nagOpen = false;
    hell.closeModal('newsletter');
    if (again) hell.at(40000, () => newsletter(hell));
  };
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-nl-no]') || t.closest('[data-nl-x]')) {
      hell.stats.closed++;
      close(true);
    }
  });
  const form = $<HTMLFormElement>(el, '[data-nl-form]');
  form?.addEventListener('submit', (e) => {
    // The address is never read, stored, or sent: the field is cleared and that's all.
    e.preventDefault();
    form.reset();
    form.hidden = true;
    const thanks = $(el, '[data-nl-thanks]');
    if (thanks) thanks.hidden = false;
    subscribed = true;
    sfx('ding');
    setTimeout(() => close(false), 2200);
  });
  hell.onBlock((blocked) => {
    if (blocked && nagOpen) close(true);
  });
}

// ---------- Postitial ----------

export function postitial(hell: Hell, then: () => void): void {
  const el = $(hell.root, '[data-postitial]');
  if (!el || hell.blocked) return then();
  const count = $(el, '[data-post-count]');
  let n = 5;
  if (count) count.textContent = String(n);
  el.hidden = false;
  hell.openModal('postitial');
  hell.see('poststitial');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    el.hidden = true;
    hell.closeModal('postitial');
    then();
  };
  const timer = setInterval(() => {
    n--;
    if (count) count.textContent = String(n);
    sfx('tick');
    if (n <= 0) finish();
  }, 1000);
  hell.onBlock((blocked) => blocked && finish());
}

// ---------- Notification pre-ask ----------

let asked = 0;
let answered = false;

export function pushAsk(hell: Hell): void {
  const el = $(hell.root, '[data-pushask]');
  if (!el || answered || hell.finished) return;
  if (hell.blocked) {
    hell.at(20000, () => pushAsk(hell));
    return;
  }
  asked++;
  const text = $(el, '[data-push-text]');
  const buttons = $(el, '[data-push-buttons]');
  if (text) {
    text.innerHTML =
      asked === 1
        ? '<b>Never miss a toast.</b> Turn on notifications from The Toastmonger?'
        : '<b>Still no toast alerts?</b> You could miss a toast. Turn on notifications?';
  }
  if (buttons) buttons.hidden = false;
  el.hidden = false;
  sfx('ping');
  hell.see('push-ask');
  if (asked > 1) hell.see('nagging');
}

export function initPushAsk(hell: Hell): void {
  const el = $(hell.root, '[data-pushask]');
  el?.addEventListener('click', (e) => {
    const choice = (e.target as HTMLElement).closest<HTMLElement>('[data-push]')?.dataset.push;
    if (!choice) return;
    if (choice === 'later') {
      el.hidden = true;
      hell.at(40000, () => pushAsk(hell));
      return;
    }
    // "Allow" would need a real browser prompt, and this page promised not to raise one.
    answered = true;
    const text = $(el, '[data-push-text]');
    const buttons = $(el, '[data-push-buttons]');
    if (text) text.innerHTML = "<b>We'd love to.</b> A real browser prompt would have to ask you, and this page promised never to raise one.";
    if (buttons) buttons.hidden = true;
    setTimeout(() => (el.hidden = true), 5000);
  });
}

// ---------- Sticky banner ----------

export function initSticky(hell: Hell): { rise(): void } {
  const el = $(hell.root, '[data-sticky]');
  if (!el) return { rise() {} };
  el.dataset.down = '';
  const grow = () => {
    if (hell.finished) return;
    const wasHidden = 'down' in el.dataset || 'compact' in el.dataset;
    delete el.dataset.down;
    delete el.dataset.compact;
    if (wasHidden) hell.see('nagging');
  };
  $(el, '[data-sticky-close]')?.addEventListener('click', () => {
    hell.stats.closed++;
    if ('compact' in el.dataset) el.dataset.down = '';
    else el.dataset.compact = '';
    hell.at(25000, grow);
  });
  return {
    rise() {
      delete el.dataset.down;
    },
  };
}
