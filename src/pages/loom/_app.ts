// Loom: wires the loom, the draft, the pattern book, and the shelf together.

import { renderPiece, raised, type Pick, type Warp } from './_cloth';
import {
  ENDS,
  HEADER_PICKS,
  MAX_REPEAT,
  PRESETS,
  SETT,
  TREADLES,
  cloneDraft,
  liftMask,
  presetById,
  type Draft,
} from './_drafts';
import { DraftSheet, paintSwatch } from './_sheet';
import { LoomSound } from './_sound';
import { LoomView } from './_view';

const OPENING = 'houndstooth';
/** Picks already woven when the page opens, so there is cloth to look at. */
const OPENING_PICKS = 24;
const MAX_PIECES = 10;

interface Piece {
  name: string;
  warp: Warp;
  picks: Pick[];
}

// The two tabby sheds, whatever the tie-up: shafts 1 and 3, then 2 and 4.
const TABBY = [0b0101, 0b1010];

export function startLoom(root: HTMLElement) {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

  const viewCanvas = $<HTMLCanvasElement>('[data-view]');
  const sheetCanvas = $<HTMLCanvasElement>('[data-sheet]');
  const paper = $<HTMLElement>('[data-paper]');
  const tally = $<HTMLElement>('[data-tally]');
  const named = $<HTMLElement>('[data-named]');
  const lockedNote = $<HTMLElement>('[data-locked]');
  const repeatLabel = $<HTMLElement>('[data-repeat-label]');
  const weaveBtn = $<HTMLButtonElement>('[data-weave]');
  const soundBtn = $<HTMLButtonElement>('[data-sound]');
  const treadleBtns = $$<HTMLButtonElement>('[data-treadle]');
  const pieceList = $<HTMLOListElement>('[data-pieces]');
  const emptyNote = $<HTMLElement>('[data-empty]');
  const dialog = $<HTMLDialogElement>('[data-piece]');
  const dialogView = $<HTMLCanvasElement>('[data-piece-view]');
  const dialogCap = $<HTMLElement>('[data-piece-cap]');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const family = getComputedStyle(root).getPropertyValue('--font-loom-sc').trim();

  let presetId: string | null = OPENING;
  let draft: Draft = cloneDraft(presetById(OPENING)!.draft);
  let warp: Warp = { threading: draft.threading.slice(), yarns: draft.warp.slice() };
  let picks: Pick[] = [];
  let shuttleSide: -1 | 1 = -1;
  let serial = 0;
  let cursor = 0;
  let holding = false;
  let streak = 0;
  let queued: number | null = null;
  const pieces: Piece[] = [];

  const sound = new LoomSound();
  const view = new LoomView(viewCanvas);
  const sheet = new DraftSheet(
    sheetCanvas,
    draft,
    {
      warpFree: () => woven() === 0,
      locked: () => {
        lockedNote.hidden = false;
        lockedNote.animate([{ background: 'rgba(164, 54, 42, 0.22)' }, { background: 'rgba(164, 54, 42, 0.07)' }], {
          duration: 700,
        });
      },
      changed: (what) => {
        presetId = null;
        if (what === 'warp' || what === 'threading') {
          warp = { threading: draft.threading.slice(), yarns: draft.warp.slice() };
          view.setCloth(warp, picks, shuttleSide);
        }
        refresh();
      },
      yarn: () => Number($<HTMLInputElement>('input[name="loom-yarn"]:checked')?.value ?? 0),
    },
    family,
  );

  const woven = () => picks.reduce((n, p) => n + (p.header ? 0 : 1), 0);
  const repeat = () => draft.treadling.length;

  function makePick(treadle: number, yarn: number, header = false): Pick {
    const mask = header ? TABBY[treadle] : liftMask(draft.tieup, treadle);
    const pick: Pick = { mask, yarn, turn: (-shuttleSide) as -1 | 1, n: serial++, header };
    return pick;
  }

  /** Tie a fresh warp on and weave the header that spreads it. */
  function tieOn(prewoven = 0) {
    picks = [];
    shuttleSide = -1;
    cursor = 0;
    for (let i = 0; i < HEADER_PICKS; i++) {
      const p = makePick(i % 2, 0, true);
      picks.push(p);
      shuttleSide = p.turn;
    }
    for (let i = 0; i < prewoven; i++) {
      const p = makePick(draft.treadling[cursor % repeat()], draft.weft[cursor % repeat()]);
      picks.push(p);
      shuttleSide = p.turn;
      cursor++;
    }
    view.setCloth(warp, picks, shuttleSide);
    refresh();
  }

  function refresh() {
    const n = woven();
    const cm = (n / SETT).toFixed(1);
    tally.textContent = `${ENDS / SETT} cm wide · ${cm} cm woven · ${n} ${n === 1 ? 'pick' : 'picks'}`;
    const preset = presetId ? presetById(presetId) : null;
    named.textContent = preset ? preset.name : 'Your own draft';
    for (const b of $$<HTMLButtonElement>('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === presetId));
    repeatLabel.textContent = `${repeat()} picks a repeat`;
    if (n === 0) lockedNote.hidden = true;
    sheet.cursor = cursor;
    view.nextYarn = draft.weft[cursor % repeat()];
    sheet.draw();
    view.setPreview(null);
  }

  function pickDuration() {
    if (reduced.matches) return 320;
    return Math.max(300, 940 * 0.84 ** streak);
  }

  function weave(treadle?: number) {
    if (view.busy) {
      if (treadle !== undefined) queued = treadle;
      return;
    }
    sound.wake();
    const row = cursor % repeat();
    const t = treadle ?? draft.treadling[row];
    const yarn = draft.weft[row];
    const pick = makePick(t, yarn);
    const dur = pickDuration();
    const btn = treadleBtns[t];
    view.weave(pick, dur, {
      open: () => {
        btn.dataset.down = '';
        sheet.pressed = t;
        sheet.draw();
        sound.treadle();
      },
      fly: () => sound.fly(dur * 0.38 * 0.001),
      land: () => sound.land(),
      impact: () => {
        picks.push(pick);
        shuttleSide = pick.turn;
        cursor++;
        sound.beat();
        refresh();
      },
      done: () => {
        delete btn.dataset.down;
        sheet.pressed = null;
        sheet.draw();
        if (queued !== null) {
          const next = queued;
          queued = null;
          weave(next);
        } else if (holding) {
          streak++;
          weave();
        }
      },
    });
  }

  function hold(on: boolean) {
    if (on && !holding) {
      holding = true;
      streak = 0;
      weaveBtn.dataset.down = '';
      if (!view.busy) weave();
    } else if (!on && holding) {
      holding = false;
      delete weaveBtn.dataset.down;
    }
  }

  function cutOff() {
    const n = woven();
    if (n === 0) return;
    const preset = presetId ? presetById(presetId) : null;
    pieces.unshift({
      name: preset ? preset.name : 'Your own draft',
      warp: { threading: warp.threading.slice(), yarns: warp.yarns.slice() },
      picks: picks.filter((p) => !p.header),
    });
    pieces.length = Math.min(pieces.length, MAX_PIECES);
    renderShelf();
    tieOn();
  }

  function choose(id: string) {
    const preset = presetById(id);
    if (!preset || view.busy) return;
    if (woven() > 0) cutOff();
    presetId = id;
    draft = cloneDraft(preset.draft);
    warp = { threading: draft.threading.slice(), yarns: draft.warp.slice() };
    sheet.setDraft(draft);
    tieOn();
  }

  // The shelf of cut-off cloth.
  function renderShelf() {
    pieceList.replaceChildren();
    emptyNote.hidden = pieces.length > 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    pieces.forEach((piece, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const cm = (piece.picks.length / SETT).toFixed(1);
      btn.setAttribute('aria-label', `${piece.name}, ${cm} centimetres: open`);
      const c = renderPiece(piece.warp, piece.picks, Math.max(2, Math.round(2 * dpr)));
      const h = Math.min(190, c.height / dpr);
      c.style.height = `${h}px`;
      c.style.width = `${(c.width / c.height) * h}px`;
      const label = document.createElement('small');
      label.textContent = `${piece.name}, ${cm} cm`;
      btn.append(c, label);
      btn.addEventListener('click', () => openPiece(i));
      li.append(btn);
      pieceList.append(li);
    });
  }

  let openIndex = -1;
  function openPiece(i: number) {
    const piece = pieces[i];
    if (!piece) return;
    openIndex = i;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    // As large as reads well, but never so long the image gets unwieldy.
    const s = Math.max(3, Math.min(Math.round(6 * dpr), Math.floor(9000 / Math.max(1, piece.picks.length + 20))));
    const c = renderPiece(piece.warp, piece.picks, s);
    dialogView.width = c.width;
    dialogView.height = c.height;
    dialogView.getContext('2d')!.drawImage(c, 0, 0);
    dialogView.style.width = `${c.width / dpr}px`;
    dialogCap.textContent = `${piece.name}: ${ENDS / SETT} by ${(piece.picks.length / SETT).toFixed(1)} cm, ${piece.picks.length} picks`;
    dialog.showModal();
  }

  $<HTMLButtonElement>('[data-piece-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  $<HTMLButtonElement>('[data-piece-save]').addEventListener('click', () => {
    const piece = pieces[openIndex];
    if (!piece) return;
    dialogView.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `loom-${piece.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  });

  // Controls.
  treadleBtns.forEach((btn, t) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      weave(t);
    });
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) weave(t);
    });
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !view.busy) view.setPreview(raised(warp, liftMask(draft.tieup, t)));
    });
    btn.addEventListener('pointerleave', () => view.setPreview(null));
  });

  weaveBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    weaveBtn.setPointerCapture(e.pointerId);
    hold(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    weaveBtn.addEventListener(type, () => hold(false));
  }
  weaveBtn.addEventListener('click', (e) => {
    if (e.detail === 0) weave();
  });

  for (const b of $$<HTMLButtonElement>('[data-cut]')) b.addEventListener('click', cutOff);

  soundBtn.addEventListener('click', () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    sound.setEnabled(on);
  });

  for (const b of $$<HTMLButtonElement>('[data-repeat]')) {
    b.addEventListener('click', () => {
      const L = repeat();
      if (b.dataset.repeat === '1' && L < MAX_REPEAT) {
        draft.treadling.push(draft.treadling[0]);
        draft.weft.push(draft.weft[0]);
      } else if (b.dataset.repeat === '-1' && L > 2) {
        draft.treadling.pop();
        draft.weft.pop();
      } else return;
      presetId = null;
      refresh();
    });
  }

  for (const b of $$<HTMLButtonElement>('[data-ink]')) {
    b.addEventListener('click', () => {
      sheet.mode = b.dataset.ink === 'colour' ? 'colour' : 'ink';
      for (const o of $$<HTMLButtonElement>('[data-ink]')) o.setAttribute('aria-pressed', String(o === b));
      sheet.draw();
    });
  }

  for (const b of $$<HTMLButtonElement>('[data-preset]')) {
    const preset = presetById(b.dataset.preset ?? '');
    const sw = b.querySelector<HTMLCanvasElement>('canvas');
    if (preset && sw) paintSwatch(sw, preset.draft);
    b.addEventListener('click', () => choose(b.dataset.preset ?? ''));
  }

  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (dialog.open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' && !(el && el.tagName === 'BUTTON')) {
      e.preventDefault();
      if (!e.repeat) hold(true);
    } else if (/^Digit[1-6]$/.test(e.code) || /^[1-6]$/.test(e.key)) {
      const t = Number(e.key) - 1;
      if (t >= 0 && t < TREADLES && !e.repeat) {
        e.preventDefault();
        weave(t);
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') hold(false);
  });
  window.addEventListener('blur', () => hold(false));

  // The pick glass follows a mouse, or a finger held on the cloth.
  const local = (e: PointerEvent) => {
    const r = viewCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let touching = false;
  viewCanvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || touching) view.setPointer(local(e));
  });
  viewCanvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') {
      touching = true;
      viewCanvas.setPointerCapture(e.pointerId);
      view.setPointer(local(e));
    }
  });
  const lift = () => {
    touching = false;
    view.setPointer(null);
  };
  viewCanvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') lift();
  });
  viewCanvas.addEventListener('pointercancel', lift);
  viewCanvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') lift();
  });

  // Layout.
  function fitSheet() {
    const avail = paper.clientWidth;
    let c = 7;
    for (let k = 9; k >= 7; k--) {
      if (DraftSheet.widthFor(k, ENDS) <= avail) {
        c = k;
        break;
      }
    }
    sheet.size(c);
  }
  const ro = new ResizeObserver(() => {
    view.resize();
    fitSheet();
  });
  ro.observe(viewCanvas);
  ro.observe(paper);

  fitSheet();
  tieOn(OPENING_PICKS);
  void document.fonts?.ready.then(() => sheet.draw());

  // Expose a handle for checks.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { loom: unknown }).loom = {
      weave,
      choose,
      cutOff,
      picks: () => picks.length,
      woven,
      presets: PRESETS.map((p) => p.id),
    };
  }
}
