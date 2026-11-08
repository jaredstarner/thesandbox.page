/*
  door.js. Ferris & Hale, job 4471.

  Runs the strongroom door. It is served exactly as written, so read as much of it as you
  like. Everything happens in your browser, so nothing here can really stop you.

  Console commands: locks(), hint(), insert(), turn(), reset().
*/
(function () {
  const root = document.querySelector('.strongroom');
  if (!root) return;

  const JOB_KEY = 'strongroom.job';
  const WIND_KEY = 'strongroom.timelock.wound';
  const WOUND_FOR = 72 * 60 * 60 * 1000;
  // The combination, scrambled so it can't be lifted straight out of this file. (n * 37 + 11) % 101.
  const COMBINATION = [3, 12, 56];
  const scramble = (n) => (n * 37 + 11) % 101;
  const GATE_ANGLE = 137;
  const CUTS = '47291';

  // Captured now, because lock 4 lets you replace Date.now and the job sheet still wants the truth.
  const trueNow = Date.now.bind(Date);
  const nativeNow = Date.now;

  const LOCKS = [
    { name: 'cam', title: 'Cam', tools: 'Styles' },
    { name: 'alarm', title: 'Alarm line', tools: 'Network' },
    { name: 'watchman', title: 'Watchman', tools: 'Sources' },
    { name: 'timelock', title: 'Time lock', tools: 'Application' },
    { name: 'key', title: 'Key', tools: 'Device toolbar, Elements, Console' },
    { name: 'second', title: 'Second key', tools: 'Two tabs, Console' },
    { name: 'combination', title: 'Combination', tools: 'Network, Animations, Sources' },
  ];

  const HINTS = {
    cam: [
      'In Elements, find sr-cam inside sr-lock[name="cam"]. The Styles pane shows a custom property called --cam.',
      'Click the value of --cam and press the up or down arrow. The cam on the door turns as you do it. Shift moves it ten degrees at a time.',
      'The notch is the dark wedge on the cam. Bring it round to the brass gate at lower right, near 137deg.',
    ],
    alarm: [
      'Open the Network panel and watch for a minute. Something called head-office.json goes out every four seconds.',
      'While that request succeeds, the lock holds. Make it fail. Read the response first: it has something you will need for the combination.',
      'Right-click the request and choose Block request URL. Or set the panel’s throttling to Offline. Two failed calls in a row and the line is dead.',
    ],
    watchman: [
      'A timer in door.js runs four times a second. If the gap between two runs is over three seconds, the watchman goes to look at the clock.',
      'In Sources, the pause button (F8) stops all script on the page. The second hand on the door stops with it.',
      'Press pause, count to four, press resume. Anything that blocks the page for three seconds will do: alert("hello") in the Console works too.',
    ],
    timelock: [
      'It wants 72 hours to pass. Waiting works; come back on the day. If not, ask where it gets its two numbers from.',
      'Application > Local Storage has an entry called strongroom.timelock.wound. That is when the lock was wound, in milliseconds since 1970.',
      'Change that entry to a smaller number, such as 1. Or give the lock a different clock: Date.now = () => 1e15 in the Console.',
    ],
    key: [
      'The cuts are stamped on the edge of the door. Turn on the Device toolbar (Ctrl+Shift+M, or Cmd+Shift+M) and set the width to 320.',
      'Back in Elements, press Ctrl+F (Cmd+F) inside the tree. It takes CSS selectors, so sr-key[bitting="..."] finds one key out of sixty-four.',
      'Click that key in Elements to select it. In the Console, $0 means whatever is selected. So: insert($0).',
    ],
    second: [
      'This lock wants two holders. Open this same page in a second tab; the small lamp beside the lock comes on when the other tab is there.',
      'Run turn() in the Console of each tab. They must land within a second and a half of each other, which is more than hands can do.',
      'In each tab, schedule it: setTimeout(turn, 15000). Do the second tab straight after the first; a window side by side helps.',
    ],
    combination: [
      'Three numbers. The first is in the response body of head-office.json, in Network.',
      'The second flashes in the small window at the top right of the dial, every nine seconds. Find sr-strobe in Elements and open the Animations drawer (Esc, then the three dots). Slow it to 10% or scrub to the flash.',
      'The third is a local variable called contact in wheelPack() in door.js. Put a breakpoint on the marked line in Sources. It runs once a second, so it stops almost at once. Read Scope, then resume.',
      'Now drag the dial on the door. Stop on the first number and let go, then the second, then the third. A small lamp lights for each one you get right. A wrong stop puts them all out.',
    ],
  };

  const lockEl = {};
  for (const { name } of LOCKS) lockEl[name] = root.querySelector(`sr-lock[name="${name}"]`);
  const door = root.querySelector('sr-door');
  const wheel = root.querySelector('sr-wheel');
  const dial = root.querySelector('sr-dial');
  const cam = root.querySelector('sr-cam');
  const sheet = root.querySelector('sr-sheet');

  /* ------------------------------------------------------------- the job, remembered */

  function blankJob() {
    return { open: {}, how: {}, relockers: 0, started: trueNow(), doorOpen: false };
  }

  function loadJob() {
    try {
      const saved = JSON.parse(localStorage.getItem(JOB_KEY));
      if (saved && typeof saved === 'object' && saved.open) return { ...blankJob(), ...saved };
    } catch {}
    return blankJob();
  }

  let job = loadJob();

  function saveJob() {
    try {
      localStorage.setItem(JOB_KEY, JSON.stringify(job));
    } catch {}
  }

  /* ------------------------------------------------------------- the console */

  const BRASS = 'color:#b8924a;font-weight:700;letter-spacing:.08em';
  const QUIET = 'color:#8a8f94';
  const CLEAR = 'color:#2fa86a;font-weight:700';
  const RED = 'color:#d0402c;font-weight:700';

  function say(text, style) {
    if (style) console.log(`%c${text}`, style);
    else console.log(text);
  }

  function greet() {
    console.log('%cFERRIS & HALE%c  Safe and lock makers. Job 4471.', BRASS, QUIET);
    say(
      [
        'Strongroom door. Combination lost, keyholders gone, no drilling.',
        '',
        'You are in the right place: everything that moves this door is in these panels.',
        '',
        '  locks()   what still holds it',
        '  hint()    a nudge on the next lock',
        '  hint(5)   a nudge on lock 5',
        '  reset()   lock it all up again',
        '',
        'Every part of the door is a live element. The last fitter left notes in the HTML, next to each lock.',
      ].join('\n'),
    );
    const left = LOCKS.filter(({ name }) => !job.open[name]).length;
    if (left < 7) say(left ? `${7 - left} of 7 already clear from your last visit.` : 'All seven are clear.', QUIET);
  }

  function locks() {
    const table = {};
    LOCKS.forEach(({ name, title, tools }, i) => {
      table[`${i + 1}. ${title}`] = { state: job.open[name] ? 'open' : 'engaged', tools };
    });
    console.table(table);
    if (relockedUntil > performance.now()) {
      say(`Relocker bolt is across the door for ${Math.ceil((relockedUntil - performance.now()) / 1000)} more seconds.`, RED);
    }
    return `${LOCKS.filter(({ name }) => job.open[name]).length} of 7 clear`;
  }

  const asked = {};

  function hint(which) {
    let lock;
    if (which === undefined) lock = LOCKS.find(({ name }) => !job.open[name]);
    else lock = LOCKS[Number(which) - 1];
    if (!lock) {
      say(which === undefined ? 'All seven are clear. Turn the wheel on the door.' : 'Locks are numbered 1 to 7.');
      return;
    }
    const lines = HINTS[lock.name];
    const seen = asked[lock.name] ?? 0;
    asked[lock.name] = Math.min(seen + 1, lines.length - 1);
    console.log(`%c${LOCKS.indexOf(lock) + 1}. ${lock.title}%c\n${lines[seen]}`, BRASS, '');
    if (seen < lines.length - 1) say('Ask again for more.', QUIET);
  }

  function reset() {
    try {
      localStorage.removeItem(JOB_KEY);
      localStorage.removeItem(WIND_KEY);
    } catch {}
    location.reload();
  }

  /* ------------------------------------------------------------- sound */

  // Short, struck sounds only, because a vault is quiet. It stays silent until something on the
  // page has been clicked, since browsers require that, and the developer tools don't count.
  let audio = null;

  function wakeAudio() {
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
    } catch {}
  }

  addEventListener('pointerdown', wakeAudio, { capture: true });
  addEventListener('keydown', wakeAudio, { capture: true });

  function strike(partials, level = 1, thump = 0) {
    if (!audio || audio.state !== 'running') return;
    const now = audio.currentTime + 0.002;
    const out = audio.createGain();
    out.gain.value = 0.34 * level;
    out.connect(audio.destination);
    for (const [hz, gain, decay] of partials) {
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.frequency.value = hz;
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(env).connect(out);
      osc.start(now);
      osc.stop(now + decay + 0.02);
    }
    if (thump) {
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.frequency.setValueAtTime(96, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
      env.gain.setValueAtTime(thump, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      osc.connect(env).connect(out);
      osc.start(now);
      osc.stop(now + 0.36);
    }
  }

  const sounds = {
    bolt: () =>
      strike(
        [
          [612, 0.2, 0.09],
          [1438, 0.12, 0.06],
          [2710, 0.05, 0.03],
        ],
        1,
        0.9,
      ),
    thud: () =>
      strike(
        [
          [190, 0.2, 0.07],
          [410, 0.08, 0.05],
        ],
        0.8,
        0.7,
      ),
    tick: () =>
      strike(
        [
          [3120, 0.1, 0.012],
          [1790, 0.05, 0.01],
        ],
        0.5,
      ),
    pawl: () =>
      strike(
        [
          [980, 0.18, 0.05],
          [2240, 0.08, 0.025],
        ],
        0.8,
      ),
    relocker: () =>
      strike(
        [
          [142, 0.4, 0.3],
          [733, 0.3, 0.42],
          [1120, 0.2, 0.34],
          [2970, 0.09, 0.12],
        ],
        1.4,
        1.2,
      ),
    swing: () =>
      strike(
        [
          [41, 0.8, 2.2],
          [62, 0.5, 1.6],
          [83, 0.25, 1.1],
        ],
        1.2,
        0.8,
      ),
  };

  /* ------------------------------------------------------------- opening a lock */

  // The door writes its own attributes through here. Anything else that writes to them is you.
  function quietly(write) {
    write();
    observer.takeRecords();
  }

  function setOpen(name, how, quiet) {
    if (job.open[name]) return;
    job.open[name] = true;
    if (how) job.how[name] = how;
    saveJob();
    show(name);
    if (quiet) return;
    sounds.bolt();
    const { title } = LOCKS.find((lock) => lock.name === name);
    say(`${title}: clear.${how ? ` ${how}` : ''}`, CLEAR);
    if (allClear()) {
      say('All seven are clear. The wheel will turn now. Go and turn it.', CLEAR);
      showWheelLine();
    }
  }

  function show(name) {
    quietly(() => lockEl[name].setAttribute('state', job.open[name] ? 'open' : 'engaged'));
    const line = sheet.querySelector(`li[data-lock="${name}"]`);
    if (line) line.toggleAttribute('data-open', Boolean(job.open[name]));
  }

  function allClear() {
    return LOCKS.every(({ name }) => job.open[name]);
  }

  function showWheelLine() {
    const line = sheet.querySelector('[data-wheel-line]');
    if (line) line.textContent = allClear() ? 'All seven are clear. Turn the wheel.' : 'Clear all seven and the wheel turns.';
  }

  /* ------------------------------------------------------------- the relocker */

  let relockedUntil = 0;
  let relockTimer = 0;

  function fireRelocker(what) {
    job.relockers += 1;
    saveJob();
    const seconds = Math.min(30 * 2 ** (job.relockers - 1), 240);
    relockedUntil = performance.now() + seconds * 1000;
    showRelockers();
    root.dataset.relocked = '';
    sounds.relocker();
    clearTimeout(relockTimer);
    relockTimer = setTimeout(() => {
      delete root.dataset.relocked;
      sounds.pawl();
      say('The relocker has drawn back. The wheel will rock again.', QUIET);
    }, seconds * 1000);
    console.warn(
      `%cRelocker fired.%c ${what} The glass plate broke and a sprung bolt went across the door. It draws back in ${seconds} seconds.\nThe state attribute only reports. The locks are opened the way the job sheet says.`,
      RED,
      '',
    );
  }

  function showRelockers() {
    const count = root.querySelector('[data-relockers]');
    if (count) count.textContent = String(job.relockers);
    root.toggleAttribute('data-cracked', job.relockers > 0);
  }

  function isDoorPart(node) {
    return node.nodeType === 1 && node.matches('sr-door, sr-face, sr-lock, sr-wheel, sr-frame, sr-world');
  }

  const observer = new MutationObserver((records) => {
    let forced = '';
    for (const record of records) {
      if (record.type === 'attributes' && record.target.matches('sr-lock')) {
        const name = record.target.getAttribute('name');
        if (!(name in lockEl)) continue;
        const truth = job.open[name] ? 'open' : 'engaged';
        if (record.target.getAttribute('state') !== truth) {
          record.target.setAttribute('state', truth);
          forced ||= `Writing on the ${name} lock's plate didn't open it.`;
        }
      }
      if (record.type === 'childList') {
        for (const node of record.removedNodes) {
          if (!isDoorPart(node)) continue;
          record.target.insertBefore(node, record.nextSibling);
          forced ||= `Taking the ${node.localName.replace('sr-', '')} off the door didn't open it.`;
        }
      }
    }
    observer.takeRecords();
    if (forced) fireRelocker(forced);
  });

  /* ------------------------------------------------------------- 1. cam */

  let camHeldSince = 0;

  function checkCam() {
    if (job.open.cam) return;
    const value = parseFloat(getComputedStyle(cam).getPropertyValue('--cam'));
    const off = Math.abs(((value - GATE_ANGLE + 540) % 360) - 180);
    if (off <= 1.5) {
      camHeldSince ||= performance.now();
      if (performance.now() - camHeldSince > 350) setOpen('cam', 'The notch is in the gate.');
    } else {
      camHeldSince = 0;
    }
  }

  /* ------------------------------------------------------------- 2. alarm line */

  let deadCalls = 0;

  async function ringHeadOffice() {
    if (document.hidden) return;
    try {
      const reply = await fetch('/strongroom/head-office.json', { cache: 'no-cache' });
      if (!reply.ok) throw new Error(String(reply.status));
      deadCalls = 0;
      lockEl.alarm.dataset.line = 'up';
      lockEl.alarm.querySelector('sr-status').textContent = job.open.alarm ? 'Line restored' : 'Line up';
      lockEl.alarm.dataset.ring = 'on';
      setTimeout(() => delete lockEl.alarm.dataset.ring, 340);
    } catch {
      deadCalls += 1;
      if (deadCalls >= 2) {
        lockEl.alarm.dataset.line = 'dead';
        lockEl.alarm.querySelector('sr-status').textContent = 'Line dead';
        setOpen('alarm', 'Head office can no longer hear the door.');
      }
    }
  }

  /* ------------------------------------------------------------- 3. watchman */

  let lastRound = performance.now();

  function watchmanRound() {
    const now = performance.now();
    const gap = now - lastRound;
    lastRound = now;
    if (document.hidden) return;
    if (gap > 3000) setOpen('watchman', 'The clock stopped and the watchman went to see why.');
  }

  document.addEventListener('visibilitychange', () => {
    lastRound = performance.now();
  });

  /* ------------------------------------------------------------- 4. time lock */

  function readWind() {
    try {
      const stored = localStorage.getItem(WIND_KEY);
      if (stored !== null && Number.isFinite(Number(stored))) return Number(stored);
      const wound = trueNow();
      localStorage.setItem(WIND_KEY, String(wound));
      return wound;
    } catch {
      return job.started;
    }
  }

  const movements = [...root.querySelectorAll('sr-movement')];
  const readout = root.querySelector('sr-readout');

  function checkTimeLock() {
    // Deliberately asks Date.now() every time, and deliberately believes the answer.
    const left = job.open.timelock ? 0 : readWind() + WOUND_FOR - Date.now();
    const shown = Math.max(0, left);
    const whole = Math.ceil(shown / 1000);
    const hours = String(Math.floor(whole / 3600)).padStart(2, '0');
    const minutes = String(Math.floor(whole / 60) % 60).padStart(2, '0');
    const seconds = String(whole % 60).padStart(2, '0');
    const text = `${hours}:${minutes}:${seconds}`;
    if (readout.textContent !== text) readout.textContent = text;
    const turned = (shown / WOUND_FOR) * 360;
    movements.forEach((movement, i) => movement.style.setProperty('--left', `${turned + i * 1.4}deg`));
    if (left <= 0 && !job.open.timelock) {
      let how = 'You changed the record of when it was wound.';
      if (Date.now !== nativeNow) how = 'You gave it a different clock.';
      else if (trueNow() - job.started >= WOUND_FOR) how = 'You waited the full 72 hours.';
      setOpen('timelock', how);
    }
  }

  /* ------------------------------------------------------------- 5. key */

  function insert(key) {
    if (job.open.key) {
      say('The key is already in, and turned.', QUIET);
      return;
    }
    if (key === undefined) {
      say('Insert what? Select a key in the Elements panel, then call insert($0).');
      return;
    }
    if (!(key instanceof Element) || !key.matches('sr-key')) {
      say(`That isn't a key. It's ${key instanceof Element ? `<${key.localName}>` : typeof key}. Select an sr-key in Elements, then insert($0).`);
      return;
    }
    const cuts = key.getAttribute('bitting') ?? '';
    if (cuts !== CUTS) {
      let right = 0;
      for (let i = 0; i < CUTS.length && cuts[i] === CUTS[i]; i++) right++;
      sounds.thud();
      say(`${cuts || 'A blank'} doesn't turn. It goes in as far as cut ${right + 1} and stops.`);
      return;
    }
    root.querySelector('sr-lock[name="key"] sr-escutcheon').append(key);
    setTimeout(() => setOpen('key', 'It turned.'), 60);
    return 'Turning.';
  }

  /* ------------------------------------------------------------- 6. second key */

  const others = new Set();
  const tabId = Math.random().toString(36).slice(2);
  const wire = 'BroadcastChannel' in window ? new BroadcastChannel('strongroom') : null;
  let myTurn = -Infinity;
  let theirTurn = -Infinity;

  // Not Date.now(), which lock 4 invites you to replace.
  const sharedClock = () => performance.timeOrigin + performance.now();

  function showHolders() {
    lockEl.second.dataset.holders = String(others.size + 1);
  }

  function checkTurns() {
    if (Math.abs(myTurn - theirTurn) <= 1500) setOpen('second', 'Both keys together.');
  }

  function turn() {
    if (job.open.second) {
      say('Both keys have already turned.', QUIET);
      return;
    }
    myTurn = sharedClock();
    wire?.postMessage({ say: 'turn', from: tabId, at: myTurn });
    lockEl.second.dataset.turning = '';
    sounds.pawl();
    setTimeout(() => delete lockEl.second.dataset.turning, 1500);
    if (others.size === 0) say('One key turned and sprang back. This lock wants a second holder. Open this page in another tab.');
    else say('Turned. It holds for a second and a half.');
    checkTurns();
  }

  if (wire) {
    wire.onmessage = ({ data }) => {
      if (!data || data.from === tabId) return;
      if (data.say === 'hello') {
        others.add(data.from);
        wire.postMessage({ say: 'here', from: tabId });
        showHolders();
      } else if (data.say === 'here') {
        others.add(data.from);
        showHolders();
      } else if (data.say === 'bye') {
        others.delete(data.from);
        showHolders();
      } else if (data.say === 'turn') {
        theirTurn = data.at;
        checkTurns();
      }
    };
    wire.postMessage({ say: 'hello', from: tabId });
    addEventListener('pagehide', () => wire.postMessage({ say: 'bye', from: tabId }));
  }

  /* ------------------------------------------------------------- 7. combination */

  /*
    The third number. Worked out once a second and never kept.

    To hear it, put a breakpoint on the "return" line below and read `contact` under Scope in
    the Sources panel. Or work out the sum on paper, if you prefer.
  */
  function wheelPack() {
    const fence = [0x1f, 0x2a, 0x4d].map((tooth, i) => tooth ^ (i * 7));
    const contact = fence.reduce((sum, tooth) => (sum * 3 + tooth) % 100, 29);
    return contact; // <- breakpoint here
  }

  let dialTurned = 0;
  let dialStage = 0;
  let dialNumber = 0;

  function dialValue() {
    return (((-Math.round(dialTurned / 3.6)) % 100) + 100) % 100;
  }

  function showDial() {
    dial.style.setProperty('--dial', `${dialTurned}deg`);
    const value = dialValue();
    if (value !== dialNumber) {
      dialNumber = value;
      dial.setAttribute('aria-valuenow', String(value));
      if (!job.open.combination) sounds.tick();
    }
  }

  function showTally() {
    const stage = job.open.combination ? 3 : dialStage;
    root.querySelectorAll('sr-tally i').forEach((pin, i) => pin.toggleAttribute('data-on', i < stage));
  }

  function dialStop() {
    if (job.open.combination) return;
    const value = dialValue();
    if (scramble(value) === COMBINATION[dialStage]) {
      dialStage += 1;
      sounds.pawl();
      showTally();
      if (dialStage === 3) setOpen('combination', 'All three contact points found.');
      return;
    }
    if (dialStage) {
      dialStage = scramble(value) === COMBINATION[0] ? 1 : 0;
      showTally();
    }
  }

  function pointerAngle(event, element) {
    const box = element.getBoundingClientRect();
    return (Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
  }

  function capture(element, event) {
    try {
      element.setPointerCapture(event.pointerId);
    } catch {}
  }

  function shortestTurn(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  let dialGrip = null;
  dial.addEventListener('pointerdown', (event) => {
    capture(dial, event);
    dialGrip = pointerAngle(event, dial);
    event.preventDefault();
  });
  dial.addEventListener('pointermove', (event) => {
    if (dialGrip === null) return;
    const angle = pointerAngle(event, dial);
    dialTurned += shortestTurn(dialGrip, angle);
    dialGrip = angle;
    showDial();
  });
  const dialRelease = () => {
    if (dialGrip === null) return;
    dialGrip = null;
    dialTurned = Math.round(dialTurned / 3.6) * 3.6;
    showDial();
    dialStop();
  };
  dial.addEventListener('pointerup', dialRelease);
  dial.addEventListener('pointercancel', dialRelease);
  dial.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') dialTurned += 3.6;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') dialTurned -= 3.6;
    else if (event.key === 'Enter' || event.key === ' ') dialStop();
    else return;
    event.preventDefault();
    showDial();
  });

  /* ------------------------------------------------------------- the wheel */

  const TURNS_TO_OPEN = 270;
  let wheelTurned = 0;
  let wheelGrip = null;
  let knocked = false;
  let wheelFalling = 0;

  function wheelFree() {
    return allClear() && relockedUntil <= performance.now();
  }

  function showWheel() {
    wheel.style.setProperty('--wheel', `${wheelTurned}deg`);
    wheel.setAttribute('aria-valuenow', String(Math.round(Math.abs(wheelTurned))));
    root.style.setProperty('--throw', String(Math.min(1, Math.abs(wheelTurned) / TURNS_TO_OPEN)));
  }

  function moveWheel(by) {
    const free = wheelFree();
    if (!free) {
      // It takes up the slack, about five degrees, and then the bolts stop it.
      const next = wheelTurned + by;
      if (Math.abs(next) >= 5) {
        wheelTurned = Math.sign(next) * 5;
        if (!knocked) {
          knocked = true;
          sounds.thud();
        }
      } else {
        wheelTurned = next;
      }
    } else {
      const before = Math.floor(Math.abs(wheelTurned) / 45);
      wheelTurned += by;
      if (Math.floor(Math.abs(wheelTurned) / 45) !== before) sounds.pawl();
      if (Math.abs(wheelTurned) >= TURNS_TO_OPEN) {
        wheelGrip = null;
        openDoor();
      }
    }
    showWheel();
  }

  function settleWheel() {
    knocked = false;
    cancelAnimationFrame(wheelFalling);
    if (wheelFree() && Math.abs(wheelTurned) > 5) return; // A free wheel stays where it is left.
    const fall = () => {
      wheelTurned *= 0.78;
      if (Math.abs(wheelTurned) < 0.05) wheelTurned = 0;
      showWheel();
      if (wheelTurned && wheelGrip === null) wheelFalling = requestAnimationFrame(fall);
    };
    wheelFalling = requestAnimationFrame(fall);
  }

  wheel.addEventListener('pointerdown', (event) => {
    capture(wheel, event);
    wheelGrip = pointerAngle(event, wheel);
    event.preventDefault();
  });
  wheel.addEventListener('pointermove', (event) => {
    if (wheelGrip === null) return;
    const angle = pointerAngle(event, wheel);
    moveWheel(shortestTurn(wheelGrip, angle));
    wheelGrip = angle;
  });
  const wheelRelease = () => {
    if (wheelGrip === null) return;
    wheelGrip = null;
    settleWheel();
  };
  wheel.addEventListener('pointerup', wheelRelease);
  wheel.addEventListener('pointercancel', wheelRelease);
  wheel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') moveWheel(9);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') moveWheel(-9);
    else return;
    event.preventDefault();
    if (!wheelFree()) {
      setTimeout(settleWheel, 120);
    }
  });

  /* ------------------------------------------------------------- the door opens */

  function zoomFactor() {
    const unit = parseFloat(getComputedStyle(door).width) / 100;
    return (Math.hypot(innerWidth, innerHeight) / (2 * 51 * unit)) * 1.04;
  }

  function fitWorld() {
    root.style.setProperty('--z', zoomFactor().toFixed(3));
  }

  function openDoor() {
    if (root.dataset.door !== 'shut') return;
    job.doorOpen = true;
    job.finished ??= trueNow();
    saveJob();
    buildRoom();
    fitWorld();
    root.querySelector('sr-room').hidden = false;
    root.dataset.door = 'opening';
    sounds.swing();
    say('The door is moving.', QUIET);
    setTimeout(() => {
      root.dataset.door = 'walking';
    }, 3600);
    setTimeout(() => {
      root.dataset.door = 'inside';
    }, 6500);
  }

  function minutesOnJob() {
    const minutes = Math.max(1, Math.round(((job.finished ?? trueNow()) - job.started) / 60000));
    if (minutes < 120) return `${minutes} min`;
    return `${Math.round(minutes / 60)} hours`;
  }

  function buildRoom() {
    const report = root.querySelector('[data-report]');
    const lines = [
      ['Time on job', minutesOnJob()],
      ['Relockers fired', String(job.relockers)],
      ['Time lock', job.how.timelock ?? 'Opened'],
    ];
    report.replaceChildren();
    for (const [term, detail] of lines) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = detail;
      report.append(dt, dd);
    }
    root.querySelector('[data-verdict]').textContent = job.relockers
      ? 'Door opened. The glass plate will need replacing.'
      : 'Door opened. No marks on it.';
    fillBoxes();
  }

  // The deposit boxes. Every other page on this site has one.
  async function fillBoxes() {
    const wall = root.querySelector('sr-boxes');
    if (wall.childElementCount) return;
    let pages = [];
    try {
      const reply = await fetch('/sitemap.xml');
      const xml = new DOMParser().parseFromString(await reply.text(), 'application/xml');
      pages = [...xml.querySelectorAll('loc')]
        .map((loc) => new URL(loc.textContent).pathname)
        .filter((path) => /^\/[a-z0-9-]+\/$/.test(path) && path !== '/strongroom/');
    } catch {}
    // clientWidth, not a bounding box: the room is still far off and scaled down at this point.
    const across = Math.max(1, getComputedStyle(wall).gridTemplateColumns.split(' ').length);
    const down = Math.max(5, Math.ceil(wall.clientHeight / 76));
    for (let i = 0; i < across * down; i++) {
      // The top rows are out of reach and out of the light, so the used boxes start lower down.
      const path = pages[i - across];
      const front = document.createElement(path ? 'a' : 'span');
      front.className = 'box';
      if (path) {
        front.href = path;
        front.dataset.name = path.slice(1, -1).replace(/-/g, ' ');
        front.title = front.dataset.name;
      }
      const tag = document.createElement('b');
      tag.textContent = String(i + 1);
      front.append(tag);
      wall.append(front);
    }
  }

  root.querySelector('[data-lock-up]').addEventListener('click', reset);

  /* ------------------------------------------------------------- light */

  const center = () => {
    const box = root.querySelector('sr-frame').getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  };

  let lightFrame = 0;
  let lightEvent = null;

  function moveLight() {
    lightFrame = 0;
    if (!lightEvent) return;
    const [x, y] = center();
    root.style.setProperty('--lx', `${lightEvent.clientX}px`);
    root.style.setProperty('--ly', `${lightEvent.clientY}px`);
    const angle = (Math.atan2(lightEvent.clientY - y, lightEvent.clientX - x) * 180) / Math.PI + 90;
    root.style.setProperty('--light', `${angle.toFixed(1)}deg`);
  }

  addEventListener('pointermove', (event) => {
    lightEvent = event;
    lightFrame ||= requestAnimationFrame(moveLight);
  });

  document.documentElement.addEventListener('pointerleave', () => {
    lightEvent = null;
    root.style.removeProperty('--lx');
    root.style.removeProperty('--ly');
    root.style.removeProperty('--light');
  });

  /* ------------------------------------------------------------- the sheet */

  const tab = root.querySelector('.sheet-tab');
  tab.addEventListener('click', () => {
    const open = sheet.toggleAttribute('data-open');
    tab.setAttribute('aria-expanded', String(open));
  });

  /* ------------------------------------------------------------- building the solid */

  function buildBolts() {
    const ring = root.querySelector('sr-bolts');
    const pieces = [];
    for (let i = 0; i < 28; i++) {
      const pin = document.createElement('i');
      pin.style.setProperty('--a', `${(i + 0.5) * (360 / 28)}deg`);
      pieces.push(pin);
    }
    ring.append(...pieces);
  }

  function buildEdge() {
    const edge = root.querySelector('sr-edge');
    const FACETS = 72;
    const chord = ((2 * Math.PI * 50) / FACETS) * 1.06;
    const pieces = [];
    for (let i = 0; i < FACETS; i++) {
      const angle = (i * 360) / FACETS;
      const facet = document.createElement('i');
      const lit = 0.5 + 0.5 * Math.cos(((angle - 215) * Math.PI) / 180);
      facet.style.setProperty('--a', `${angle}deg`);
      facet.style.setProperty('--chord', chord.toFixed(3));
      facet.style.setProperty('--dark', (0.62 - 0.62 * lit).toFixed(3));
      if (i % 4 === 2) facet.dataset.bolt = '';
      pieces.push(facet);
    }
    edge.append(...pieces);
  }

  /* ------------------------------------------------------------- the rounds */

  let second = -1;

  function rounds() {
    watchmanRound();
    checkCam();
    checkTimeLock();
    const now = Math.floor(performance.now() / 1000);
    if (now !== second && !document.hidden) {
      second = now;
      root.querySelector('sr-hand').style.setProperty('--second', `${(now % 60) * 6}deg`);
      wheelPack();
    }
  }

  function restore() {
    buildBolts();
    buildEdge();
    for (const { name } of LOCKS) show(name);
    if (job.open.cam) cam.style.setProperty('--cam', `${GATE_ANGLE}deg`);
    showRelockers();
    showTally();
    showWheelLine();
    showHolders();
    if (job.open.alarm) lockEl.alarm.querySelector('sr-status').textContent = 'Line dead';
    if (job.open.key) {
      const key = root.querySelector(`sr-key[bitting="${CUTS}"]`);
      if (key) root.querySelector('sr-lock[name="key"] sr-escutcheon').append(key);
    }
    if (job.doorOpen) {
      buildRoom();
      fitWorld();
      root.querySelector('sr-room').hidden = false;
      root.dataset.door = 'inside';
    }
  }

  // Another tab opened something: show it here too.
  addEventListener('storage', (event) => {
    if (event.key !== JOB_KEY) return;
    job = loadJob();
    for (const { name } of LOCKS) show(name);
    showRelockers();
    showTally();
    showWheelLine();
  });

  addEventListener('resize', () => {
    if (root.dataset.door !== 'shut') fitWorld();
  });

  // Not status(): window.status has belonged to the browser since the nineties.
  window.locks = locks;
  window.hint = hint;
  window.insert = insert;
  window.turn = turn;
  window.reset = reset;

  restore();
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['state'] });
  greet();
  rounds();
  ringHeadOffice();
  setInterval(rounds, 250);
  setInterval(ringHeadOffice, 4000);
})();
