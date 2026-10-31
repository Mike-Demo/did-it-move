/*
 * reactor-live.js — cost-guarded Reactor session wrapper for Did It Move?
 *
 * Why this file exists: Reactor bills per session-second from the moment a
 * session reaches `ready`, even while idle, and a recoverable disconnect
 * keeps billing. So live generation is ONLY ever opened inside a burst,
 * for a hard-capped number of seconds, with a non-recoverable disconnect,
 * behind a daily budget kill-switch. See README.md for the cost math.
 *
 * To go live:
 *   1. Run a tiny token server that holds your Reactor API key (rk_...) and
 *      mints short-lived session JWTs. NEVER put the API key in this file —
 *      the browser must only ever see the session token.
 *   2. Set CONFIG.tokenEndpoint to that server's URL.
 *   3. Provide an adapter: load the model SDK in your bundler build, e.g.
 *        import { XmaxX21Model } from "@reactor-models/xmax-x2-1";
 *        // or, for the open-weight route at the same $0.0017/sec rate:
 *        // import { SanaStreamingModel } from "@reactor-models/sana-streaming";
 *        window.ReactorAdapter = {
 *          async connect(jwt) { ... },        // -> model instance
 *          async setPrompt(model, prompt) {}, // model.setPrompt({ prompt })
 *          async publishSource(model, track) {},
 *          async disconnect(model) {},        // non-recoverable, stops billing
 *        };
 *   Until both are present, start() refuses and the app stays pre-recorded.
 */
(function () {
  'use strict';

  var CONFIG = {
    tokenEndpoint: '', // e.g. 'https://your-server.example/reactor/token'
    model: 'xmax-x2-1', // 'xmax-x2-1' | 'sana-streaming' | 'longlive-v2'
    rateUsdPerSec: 0.0017, // live-checked 2026-10-28 via GET https://api.reactor.inc/pricing
    maxSecondsPerSession: 120, // hard cap — Reactor's own docs suggest capping demos
    dailyBudgetUsd: 2.0, // kill-switch: no new live sessions once today's spend hits this
    storageKey: 'did-it-move-live-spend',
  };

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function spentToday() {
    try {
      var raw = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}');
      return raw.date === todayKey() ? Number(raw.usd || 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function recordSpend(usd) {
    try {
      localStorage.setItem(
        CONFIG.storageKey,
        JSON.stringify({ date: todayKey(), usd: spentToday() + usd })
      );
    } catch (e) { /* private mode etc. — the in-memory cap still applies */ }
  }

  function ReactorBurstSession() {
    this.model = null;
    this.startedAt = 0;
    this.timer = null;
    this.onAutoStop = null;
  }

  ReactorBurstSession.prototype.remainingBudget = function () {
    return Math.max(0, CONFIG.dailyBudgetUsd - spentToday());
  };

  ReactorBurstSession.prototype.estimate = function (seconds) {
    return seconds * CONFIG.rateUsdPerSec;
  };

  ReactorBurstSession.prototype.start = async function (prompt, sourceTrack) {
    if (!CONFIG.tokenEndpoint) {
      throw new Error('No token endpoint configured — staying pre-recorded ($0).');
    }
    if (!window.ReactorAdapter) {
      throw new Error('No ReactorAdapter — load the model SDK first. Staying pre-recorded.');
    }
    if (this.remainingBudget() < this.estimate(5)) {
      throw new Error('Daily live budget exhausted — kill-switch engaged. Staying pre-recorded.');
    }

    var res = await fetch(CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.model }),
    });
    if (!res.ok) throw new Error('Token endpoint returned ' + res.status);
    var data = await res.json();

    this.model = await window.ReactorAdapter.connect(data.jwt);
    this.startedAt = Date.now();
    if (sourceTrack && window.ReactorAdapter.publishSource) {
      await window.ReactorAdapter.publishSource(this.model, sourceTrack);
    }
    if (prompt) await window.ReactorAdapter.setPrompt(this.model, prompt);

    // Hard cap: billing stops because WE stop it, not because we hope to.
    var self = this;
    this.timer = setTimeout(function () {
      self.stop().then(function () {
        if (typeof self.onAutoStop === 'function') self.onAutoStop();
      });
    }, CONFIG.maxSecondsPerSession * 1000);
    return this.model;
  };

  ReactorBurstSession.prototype.elapsedSeconds = function () {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  };

  ReactorBurstSession.prototype.stop = async function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    var seconds = this.elapsedSeconds();
    if (this.model && window.ReactorAdapter) {
      try { await window.ReactorAdapter.disconnect(this.model); } catch (e) { /* still record spend */ }
    }
    this.model = null;
    this.startedAt = 0;
    if (seconds > 0) recordSpend(seconds * CONFIG.rateUsdPerSec);
    return seconds;
  };

  window.ReactorLive = {
    CONFIG: CONFIG,
    ReactorBurstSession: ReactorBurstSession,
    spentToday: spentToday,
  };
})();
