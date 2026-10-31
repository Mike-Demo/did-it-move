# Did It Move?

An ambient haunting for smart TVs and large monitors, built for the
[DEV Hacktoberfest Week 4 challenge — "Ghost in the Machine"](https://dev.to/challenges/hacktoberfest-week4-2026-10-26)
(deadline: October 31, 2026, 11:59 PM PDT).

Open it fullscreen on a TV and forget it. A cozy living room — fireplace,
rain on the window, a portrait, a rocking chair — sits quietly for minutes
at a time. Then, for a few seconds, something subtly wrong happens. When
it's over, one thing in the room is different from before, and the room's
log insists nothing happened at all.

*Did the portrait always look toward the sofa? Has that picture always
hung crooked? You can't prove it didn't.*

## Why it isn't just "run a real-time model all evening"

Real-time video models (here: Reactor's `xmax-x2-1`, a streaming
video-to-video model) bill for **session time**, not for interesting
moments. Checked live on 2026-10-28 against Reactor's public pricing
endpoint (`GET https://api.reactor.inc/pricing`):

| Model | Rate | Per hour, per viewer |
| --- | --- | --- |
| `xmax-x2-1` | $0.0017 / sec | $6.12 |
| `sana-streaming` (open-weight) | $0.0017 / sec | $6.12 |
| `longlive-v2` (open) | $0.0017 / sec | $6.12 |

Reactor bills from the moment a session reaches `ready`, even while idle,
and a *recoverable* disconnect keeps the meter running. An always-on
ambient piece therefore costs **$6.12/hour per screen** — $48.96 for one
Halloween evening on one TV, ~$147/day running 24/7, and unbounded cost
on a public demo page where every visitor holds their own GPU session.

## The hybrid architecture

```
IDLE (99% of the time)     BURST (5–8 seconds)            AFTER
───────────────────────    ───────────────────────────    ─────────────────────
Zero-cost CSS/SVG room  →  ONE subtle wrongness       →  One thing stays changed
$0.00, runs forever        live model session OR         (the gaslight layer),
                           pre-recorded clip             log denies everything
                           $0.05 at live rates
```

1. **Idle layer** — a hand-built room (this repo, no assets, no network).
2. **Burst layer** — every 4–7 minutes, a single event: the portrait's
   eyes shift, a shadow crosses the window, the chair rocks itself, the
   candle goes out, a book falls, a figure stands in the mirror only.
   In **live mode** a Reactor session exists *only* for these seconds:
   120-second hard cap, non-recoverable disconnect, $2/day budget
   kill-switch (`reactor-live.js`). At a ~2% duty cycle, an evening of
   live haunting costs cents, not $49.
3. **Public mode** — bursts captured once during development are replayed
   as the default public experience. Visitors cost **$0.00**; the HUD
   shows the *would-be* live cost of each burst as a shadow price.
4. **Gaslight layer** — after each burst, exactly one change persists
   (picture crooked, candle out, chair turned, book on the floor), and
   the event log records a denial with a timestamp.

## Run it

Any static server:

```bash
python3 -m http.server 8000
# open http://localhost:8000 on the TV's browser, press F for fullscreen
```

Controls (they auto-hide after 5s — a clean screen is the product):

| Key / button | Action |
| --- | --- |
| `B` | Something happen now |
| *(toggle)* Demo pace | Bursts every ~15s instead of 4–7 min — for demos and judging |
| `H` | The log of things that did not happen |
| `L` | Live-mode panel |
| `R` | Reset the room (it remembers nothing) |
| `F` | Fullscreen |

## Capturing bursts with OpenRouter (the default production path)

OpenRouter's video API is asynchronous and priced per output second —
submit, poll, download — so there is no session and no idle billing.
That makes it the cheapest sane way to *capture* the bursts once and
replay them forever. The app plays `bursts/<event>.mp4` automatically
when the file exists.

```bash
node tools/capture-bursts.mjs                     # dry run: payloads + estimate, $0
OPENROUTER_API_KEY=sk-or-... node tools/capture-bursts.mjs --live
```

Checked against the live catalog (`GET /api/v1/videos/models`,
2026-10-28), no audio, per 6-second clip:

| Model | Rate | 7 events × 3 takes |
| --- | --- | --- |
| `bytedance/seedance-1-5-pro` 480p | ≈ $0.0115/sec | ≈ $1.45 |
| `google/veo-3.1-lite` 720p | $0.03/sec | $5.04 (8s clips) |
| `alibaba/wan-3.0` 720p | $0.10/sec | $12.60 |

Most of these support **first-frame + last-frame** control: screenshot the
room before and after a change, set `FRAME_BASE_URL`, and the model only
has to animate the transition between two frames you chose — the
gaslight effect, with both endpoints pinned by you.

Guardrails in the tool: `x-ai/*` models and any auto-routing are refused
outright; use a **dedicated** OpenRouter key with its own low cap for
this project (do not reuse a key that belongs to another app); job IDs
are saved to `bursts/jobs.json` before polling so a crash never causes a
duplicate charge. Note that OpenRouter is *not* a substitute for the live
mode below: it generates clips over minutes, it does not stream.

## Going live with Reactor

1. Create a Reactor account and an API key (`rk_...`). **Keep the key on a
   server** — the browser must only ever receive a short-lived session JWT.
2. Point `CONFIG.tokenEndpoint` in `reactor-live.js` at a tiny token
   server that mints those JWTs.
3. In a bundler build, load the model SDK and set `window.ReactorAdapter`
   (interface documented in `reactor-live.js`):
   `@reactor-models/xmax-x2-1` for video-to-video re-rendering, or the
   open-weight models at the identical rate (`sana-streaming`,
   `longlive-v2`) — see the open-innovation note in the DEV post draft.
4. To capture pre-recorded bursts, record the session's `main_video`
   track with `MediaRecorder` during a live burst and drop the clip into
   the burst rotation.

Estimated cost to produce the submission: ~8 events × 3 takes × ~40s
of live capture ≈ **$1.63**, plus under an hour of live testing (≈ $6).

## Verification

- `node --check app.js reactor-live.js` — syntax.
- The DOM-stub harness in `tools/` exercised the burst engine end-to-end:
  burst fires → denial is logged → a `changed-*` gaslight class persists →
  would-be cost accumulates. (Timers compressed for the harness; in the
  browser a burst is 6.2s at a shadow price of ~$0.01.)

## License

MIT — see `LICENSE`.
