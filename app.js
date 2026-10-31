/* Did It Move? — burst engine + gaslight layer.
 *
 * Architecture (the whole point of the project):
 *   IDLE   — a zero-cost CSS/SVG room. Can run on a TV forever. $0.
 *   BURST  — 5–8 seconds where something subtly wrong happens. In public
 *            mode this is pre-recorded / pre-scripted ($0 per visitor).
 *            In live mode a Reactor session exists ONLY for these seconds.
 *   AFTER  — exactly one thing stays changed (the gaslight layer), and the
 *            room's log denies it ever happened.
 */
(function () {
  'use strict';

  var RATE_USD_PER_SEC = 0.0017; // xmax-x2-1 / sana-streaming / longlive-v2, checked 2026-10-28
  var BURST_MS = 6200;

  var scene = document.getElementById('scene');
  var modeBadge = document.getElementById('modeBadge');
  var costReadout = document.getElementById('costReadout');
  var nextReadout = document.getElementById('nextReadout');
  var eventLog = document.getElementById('eventLog');
  var logPanel = document.getElementById('logPanel');
  var livePanel = document.getElementById('livePanel');
  var ariaStatus = document.getElementById('ariaStatus');

  var EVENTS = [
    {
      id: 'portrait', burstClass: 'burst-portrait', changedClass: 'changed-portrait',
      livePrompt: 'The portrait\'s eyes shift very slowly to look toward the sofa. Nothing else moves. Photorealistic, subtle, no camera movement.',
      deny: 'The portrait has always looked that way.',
    },
    {
      id: 'shadow', burstClass: 'burst-shadow', changedClass: null,
      livePrompt: 'A tall shadow passes slowly across the window, outside, against the moonlight. Nothing inside the room changes.',
      deny: 'Those stars were always out. You simply never looked up.',
    },
    {
      id: 'chair', burstClass: 'burst-chair', changedClass: 'changed-chair',
      livePrompt: 'The empty rocking chair rocks gently on its own, slows, and ends facing the other way. No person appears.',
      deny: 'Chairs settle. Old houses settle. You imagined the rest.',
    },
    {
      id: 'candle', burstClass: null, changedClass: 'changed-candle',
      livePrompt: 'The candle flame gutters, leans as if someone breathed near it, and goes out. A thin line of smoke rises.',
      deny: 'A draft. There is always a draft in this room.',
    },
    {
      id: 'picture', burstClass: null, changedClass: 'changed-picture',
      livePrompt: 'The small framed picture on the wall tilts very slowly, a few degrees, as if its nail slipped. Nothing else moves.',
      deny: 'That picture has hung crooked since October.',
    },
    {
      id: 'book', burstClass: null, changedClass: 'changed-book',
      livePrompt: 'One book slides a few centimetres out of the bookshelf, pauses, then drops softly to the floor.',
      deny: 'You left it on the table. You must have.',
    },
    {
      id: 'mirror', burstClass: 'burst-mirror', changedClass: null,
      livePrompt: 'In the mirror only, a still figure stands behind the sofa for a few seconds, then is gone. The room itself stays empty.',
      deny: 'Mirrors show the room. The room is empty. It was empty.',
    },
  ];

  var state = {
    bursting: false,
    live: false, // true only while a real Reactor session is open
    wouldBeCost: 0, // shadow price of bursts, in pre-recorded mode
    liveCost: 0, // real spend this page session, in live mode
    demoPace: false,
    scheduleTimer: null,
    ticker: null,
    nextAt: 0,
    liveSession: null,
    changes: [],
  };

  function fmt(n) { return '$' + n.toFixed(4); }

  function renderCost() {
    costReadout.textContent =
      'Live cost this session: ' + fmt(state.liveCost) +
      ' · Would-be live cost: ' + fmt(state.wouldBeCost);
  }

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function deny(ev) {
    var li = document.createElement('li');
    var t = document.createElement('time');
    t.textContent = nowTime();
    li.appendChild(t);
    li.appendChild(document.createTextNode(ev.deny));
    eventLog.prepend(li);
    ariaStatus.textContent = 'Nothing happened. ' + ev.deny;
  }

  function pickEvent() {
    // Prefer events whose permanent change hasn't happened yet, so the
    // room degrades slowly and in a different order every evening.
    var fresh = EVENTS.filter(function (e) {
      return !e.changedClass || state.changes.indexOf(e.changedClass) === -1;
    });
    var pool = fresh.length ? fresh : EVENTS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function scheduleNext() {
    clearTimeout(state.scheduleTimer);
    var wait = state.demoPace
      ? 12000 + Math.random() * 9000 // judges shouldn't have to wait 5 minutes
      : 240000 + Math.random() * 180000; // ambient TV pace: every 4–7 minutes
    state.nextAt = Date.now() + wait;
    state.scheduleTimer = setTimeout(function () { runBurst(pickEvent()); }, wait);
  }

  function tickCountdown() {
    if (state.bursting) {
      nextReadout.textContent = state.live
        ? 'Something is happening. The session clock is running.'
        : 'Something is happening.';
      return;
    }
    var s = Math.max(0, Math.round((state.nextAt - Date.now()) / 1000));
    nextReadout.textContent = s > 90
      ? 'The room is quiet.'
      : 'The room is quiet. Mostly. (' + s + 's)';
  }
  setInterval(tickCountdown, 1000);

  async function tryStartLive(ev) {
    if (!window.ReactorLive) return false;
    try {
      state.liveSession = new window.ReactorLive.ReactorBurstSession();
      // The idle scene is the source: feed the room, ask for one subtle wrongness.
      await state.liveSession.start(ev.livePrompt, null);
      state.live = true;
      modeBadge.textContent = 'MODE · LIVE BURST · $0.0017/sec · capped 120s';
      modeBadge.classList.add('live');
      return true;
    } catch (err) {
      var el = document.getElementById('liveStatus');
      if (el) el.textContent = String(err.message || err) + ' Bursts remain pre-recorded.';
      state.liveSession = null;
      return false;
    }
  }

  async function stopLive() {
    if (state.liveSession) {
      var secs = await state.liveSession.stop();
      state.liveCost += secs * RATE_USD_PER_SEC;
      state.liveSession = null;
    }
    state.live = false;
    modeBadge.textContent = 'MODE · PRE-RECORDED · $0.00 / visitor';
    modeBadge.classList.remove('live');
  }

  async function runBurst(ev) {
    if (state.bursting) return;
    state.bursting = true;
    clearTimeout(state.scheduleTimer);

    // In live mode the Reactor session opens here — and only here.
    await tryStartLive(ev);

    scene.classList.add('bursting');
    if (ev.burstClass) scene.classList.add(ev.burstClass);

    // Pre-recorded layer: if a captured clip exists for this event, play it
    // over the room. If not (no bursts/ folder yet), the CSS burst stands alone.
    var vid = document.getElementById('burstVideo');
    if (vid && typeof vid.play === 'function') {
      vid.src = 'bursts/' + ev.id + '.mp4';
      var p = vid.play();
      if (p && typeof p.then === 'function') {
        p.then(function () { vid.classList.add('playing'); })
         .catch(function () { vid.classList.remove('playing'); });
      }
    }
    if (ev.id === 'candle') scene.classList.add('changed-candle'); // the gutter IS the moment

    var started = Date.now();
    state.ticker = setInterval(function () {
      var secs = (Date.now() - started) / 1000;
      costReadout.textContent =
        'Burst running: ' + secs.toFixed(1) + 's · live rate $0.0017/sec · burst cost so far ' +
        fmt(secs * RATE_USD_PER_SEC);
    }, 120);

    var burstEnded = false;
    var endBurst = async function () {
      if (burstEnded) return;
      burstEnded = true;
      clearTimeout(endTimer);
      clearInterval(state.ticker);
      var secs = (Date.now() - started) / 1000;
      state.wouldBeCost += secs * RATE_USD_PER_SEC;
      await stopLive();

      scene.classList.remove('bursting');
      if (ev.burstClass) scene.classList.remove(ev.burstClass);
      var vid2 = document.getElementById('burstVideo');
      if (vid2) {
        vid2.onloadedmetadata = null;
        vid2.onended = null;
        vid2.classList.remove('playing');
        if (typeof vid2.pause === 'function') vid2.pause();
        if (typeof vid2.removeAttribute === 'function') vid2.removeAttribute('src');
        if (typeof vid2.load === 'function') vid2.load();
      }
      // The gaslight layer: one thing stays wrong after the burst ends.
      if (ev.changedClass && state.changes.indexOf(ev.changedClass) === -1) {
        scene.classList.add(ev.changedClass);
        state.changes.push(ev.changedClass);
      }
      deny(ev);
      renderCost();
      state.bursting = false;
      scheduleNext();
    };
    var endTimer = setTimeout(endBurst, BURST_MS);
    // A captured clip runs longer than a CSS burst: when its metadata lands,
    // stretch this burst to the clip's full length (capped) so the event
    // plays out instead of being cut at BURST_MS.
    if (vid) {
      vid.onloadedmetadata = function () {
        if (isFinite(vid.duration) && vid.duration > BURST_MS / 1000) {
          clearTimeout(endTimer);
          endTimer = setTimeout(endBurst, Math.min(20000, vid.duration * 1000 + 600));
        }
      };
      vid.onended = function () { endBurst(); };
    }
  }

  function resetRoom() {
    EVENTS.forEach(function (e) { if (e.changedClass) scene.classList.remove(e.changedClass); });
    state.changes = [];
    eventLog.innerHTML = '';
    ariaStatus.textContent = 'The room has been tidied. It remembers nothing.';
  }

  /* ---------- HUD auto-hide (TV: clean screen is the product) ---------- */
  var hudTimer = null;
  function wakeHud() {
    scene.classList.remove('hud-hidden');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { scene.classList.add('hud-hidden'); }, 5000);
  }
  document.addEventListener('mousemove', wakeHud);
  document.addEventListener('keydown', wakeHud);
  wakeHud();

  /* ---------- Wake lock (best effort; TVs vary) ---------- */
  if (navigator.wakeLock) {
    navigator.wakeLock.request('screen').catch(function () { /* ambient nicety only */ });
  }

  /* ---------- Controls ---------- */
  document.getElementById('burstBtn').addEventListener('click', function () { runBurst(pickEvent()); });
  document.getElementById('resetBtn').addEventListener('click', resetRoom);
  document.getElementById('logBtn').addEventListener('click', function () { logPanel.hidden = !logPanel.hidden; });
  document.getElementById('liveBtn').addEventListener('click', function () { livePanel.hidden = !livePanel.hidden; });
  document.getElementById('closeLiveBtn').addEventListener('click', function () { livePanel.hidden = true; });
  document.getElementById('fullBtn').addEventListener('click', function () {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });
  var paceBtn = document.getElementById('paceBtn');
  paceBtn.addEventListener('click', function () {
    state.demoPace = !state.demoPace;
    paceBtn.textContent = 'Demo pace: ' + (state.demoPace ? 'on' : 'off');
    paceBtn.setAttribute('aria-pressed', String(state.demoPace));
    if (!state.bursting) scheduleNext();
  });
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (k === 'b') runBurst(pickEvent());
    else if (k === 'r') resetRoom();
    else if (k === 'h') logPanel.hidden = !logPanel.hidden;
    else if (k === 'l') livePanel.hidden = !livePanel.hidden;
    else if (k === 'f' && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });

  renderCost();
  scheduleNext();
})();
