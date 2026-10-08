// The chat bubble that pings and the strangers who keep buying toasters. All canned; nobody is there.

import { pick, rand, type Hell } from './_hell';
import { sfx } from './_sound';

const REPLIES: Record<string, { ask: string; answer: string }> = {
  recipe: {
    ask: 'I just want the recipe',
    answer: 'Great question! Our recipe works best with the CRUMBTRONIC 3000. Want me to add one to your cart? 😊',
  },
  discount: {
    ask: 'Is the toaster really 70% off?',
    answer: "It's 70% off a price nobody has ever paid! 😊",
  },
  human: {
    ask: 'Are you a real person?',
    answer: "I'm as real as the discount! 😊",
  },
  bye: {
    ask: 'No thanks',
    answer: "No problem! I'll check back in thirty seconds. 😊",
  },
};

export function initChat(hell: Hell): { ping(): void } {
  const el = hell.root.querySelector<HTMLElement>('[data-chat]');
  if (!el) return { ping() {} };
  const panel = el.querySelector<HTMLElement>('[data-chat-panel]')!;
  const teaser = el.querySelector<HTMLElement>('[data-chat-teaser]')!;
  const badge = el.querySelector<HTMLElement>('[data-chat-badge]')!;
  const log = el.querySelector<HTMLElement>('[data-chat-log]')!;
  const quick = el.querySelector<HTMLElement>('[data-chat-quick]')!;
  let unread = 0;
  let greeted = false;
  let used = new Set<string>();
  let teaserTimer = 0;

  const say = (who: 'bot' | 'me', text: string) => {
    const li = document.createElement('li');
    li.className = who;
    li.textContent = text;
    log.append(li);
    log.scrollTop = log.scrollHeight;
  };

  const renderQuick = () => {
    quick.replaceChildren(
      ...Object.entries(REPLIES)
        .filter(([key]) => !used.has(key))
        .map(([key, r]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.reply = key;
          b.textContent = r.ask;
          return b;
        }),
    );
  };

  const open = () => {
    panel.hidden = false;
    teaser.hidden = true;
    unread = 0;
    badge.hidden = true;
    if (!greeted) {
      greeted = true;
      say('bot', "Hi! 👋 I'm Crumb, The Toastmonger's assistant. Can I help you find a toaster today?");
    }
    renderQuick();
  };

  const close = () => {
    panel.hidden = true;
  };

  const ping = () => {
    if (hell.finished) return;
    if (!hell.blocked && panel.hidden) {
      el.hidden = false;
      unread++;
      badge.textContent = String(unread);
      badge.hidden = false;
      teaser.hidden = false;
      clearTimeout(teaserTimer);
      teaserTimer = window.setTimeout(() => (teaser.hidden = true), 6000);
      sfx('ping');
      hell.see('chat');
    }
    hell.at(35000, ping);
  };

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-chat-open]') || t.closest('[data-chat-teaser]')) {
      if (panel.hidden) open();
      else close();
      return;
    }
    if (t.closest('[data-chat-x]')) {
      close();
      return;
    }
    const key = t.closest<HTMLElement>('[data-reply]')?.dataset.reply;
    if (!key) return;
    const r = REPLIES[key];
    used.add(key);
    if (used.size === Object.keys(REPLIES).length) used = new Set(['bye']);
    say('me', r.ask);
    quick.replaceChildren();
    const typing = document.createElement('li');
    typing.className = 'bot typing';
    typing.textContent = 'Crumb is typing…';
    log.append(typing);
    log.scrollTop = log.scrollHeight;
    setTimeout(() => {
      typing.remove();
      say('bot', r.answer);
      sfx('ping');
      if (key === 'bye') setTimeout(close, 1200);
      else renderQuick();
    }, 900);
  });

  return { ping };
}

const PEOPLE = ['Gary in Tulsa', 'Priya in Leeds', 'Tom in Duluth', 'Ana in Porto', 'Mo in Cork', 'Bea in Fresno', 'Kenji in Osaka', 'Lou in Hobart', 'Dee in Akron', 'Sven in Malmö'];
const BUYS = ['a CRUMBTRONIC 3000', 'a LOAFLY free trial', 'SOKKIT smart socks (left only)', 'a SNOOZLE mattress', '100 BREADCOIN', 'the Slouchmore, again'];

export function initProof(hell: Hell): { show(): void } {
  const layer = hell.root.querySelector<HTMLElement>('[data-proof]');
  const show = () => {
    if (!layer || hell.finished) return;
    if (!hell.blocked) {
      const card = document.createElement('div');
      card.className = 'proof-card';
      card.innerHTML =
        `<span class="proof-dot" aria-hidden="true"></span>` +
        `<span><b>${pick(PEOPLE)}</b> just bought ${pick(BUYS)}<small>${Math.floor(rand(1, 12))} minutes ago · ✓ Verified by Proofly</small></span>`;
      layer.replaceChildren(card);
      hell.see('fake-social-proof');
      setTimeout(() => card.classList.add('out'), 5200);
      setTimeout(() => card.remove(), 5800);
    }
    hell.at(rand(12000, 18000), show);
  };
  return { show };
}
