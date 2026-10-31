---
title: Did It Move? An ambient TV haunting that costs $6.12 an hour — so I made it cost cents
published: false
tags: devchallenge, hf26challenge
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 4: Ghost in the Machine](https://dev.to/challenges/hacktoberfest-week4-2026-10-26)*

## What I Built

**Did It Move?** is an ambient haunting designed for the biggest, dumbest screen in the house: the TV.

Open it fullscreen and forget it exists. A cozy living room — fire going, rain on the window, a portrait, a rocking chair, a candle — sits quietly for minutes at a time. Then, for a few seconds, something subtly wrong happens. The portrait's eyes are looking somewhere new. A shadow crosses the window that no one casts. The rocking chair rocks itself, gently, and stops facing the other way.

When it's over, exactly one thing in the room is different from before — and the room's own event log, timestamped, insists nothing happened:

> *9:42 PM — That picture has hung crooked since October.*
> *10:17 PM — Books fall. Gravity is not a haunting.*

The horror isn't a jump scare. It's the argument you'll have with the person next to you on the couch: *I'm sure that candle was lit.*

## Demo

Live demo: https://did-it-move.space.fast/

{% embed https://www.youtube.com/watch?v=fhNsyiQUEg0 %}

Try **Demo pace** in the live demo — bursts arrive every ~15 seconds instead of every 4–7 minutes, because judges, unlike ghosts, are busy.

And here is the full hour the room can haunt, if you have a TV and an evening:

{% embed https://www.youtube.com/watch?v=X2O1X_h_zHU %}

## Code

{% github Mike-Demo/did-it-move %}

## How I Built It

### The idea vs. the invoice

The obvious way to build this is a real-time generative video model — I prototyped against Reactor's `xmax-x2-1`, a streaming video-to-video model whose SDK (`@reactor-models/xmax-x2-1`) lets you feed it a source stream, set a prompt, and re-render the world as it happens. Feed it the quiet room, prompt *"the portrait's eyes shift, slowly"*, and the room haunts itself.

Then I checked the pricing endpoint. Reactor charges **$0.0017 per session-second** for this model — $6.12 an hour — billed from the moment a session is ready, *including while it sits idle*, per viewer. My quiet room is idle 99% of the time, by design. The naive version costs:

- $48.96 for one Halloween evening on one TV
- ~$147 a day if you leave it on
- an unbounded amount the moment you post a public demo link, because every visitor holds their own GPU session

The whole project became: **how do you build an ambient generative piece when generation is priced per second and ambience is priced per hour?**

### The hybrid: generate the moments, not the room

1. **Idle layer (99% of the time, $0).** The room itself is hand-built CSS/SVG — fire, rain, moonlight. It can run on a TV forever for free.
2. **Burst layer (5–8 seconds).** A generative session exists *only* while something is happening: a 120-second hard cap, a non-recoverable disconnect (a recoverable one keeps billing — read the docs, learn from my near-miss), and a daily budget kill-switch. At a ~2% duty cycle, a live evening costs cents.
3. **Public mode ($0 per visitor).** The bursts used by the public demo were captured once, during development, and are replayed. The HUD shows each burst's *would-be* live cost as a shadow price, so the economics stay visible instead of hidden.
4. **Gaslight layer ($0, and the actual joke).** The lasting changes — crooked picture, dead candle, turned chair — are cheap DOM state. The most memorable part of the piece costs nothing at all, which is rather the point.

The app itself is vanilla HTML/CSS/JS, no build step, no assets — it has to run in whatever browser a smart TV shipped with. The cost guardrails live in one file, `reactor-live.js`, and the burst prompts for each event live next to their pre-recorded fallbacks in `app.js`.

## Why Does Open Innovation Matter?

Two honest answers.

**The swap test.** Because Reactor hosts several models behind one SDK, I could price the closed `xmax-x2-1` against the open-weight `sana-streaming` and `longlive-v2` — and they are listed at the *identical* $0.0017/sec. When open weights cost the same as a closed model, "we can't afford to go open" stops being an argument; the decision becomes about control, longevity, and whether your ambient ghost still works the day a vendor changes its pricing page.

**The exit door.** The burst prompts are plain text, the room is open code, and nothing in the piece depends on one vendor's session: a burst is a burst whether a hosted model renders it live, a local model renders it later, or — as in the public demo — it was rendered once and kept. Open models and open code are what let a $6.12-an-hour idea become a piece that can live on a TV, in a repo, after the hackathon, for free.

## My Agent Session

<!-- Optional: paste your DevRelay session link here, or embed it with {% agent_session ... %} — or delete this section. -->

## The Spirit of It

The moment it landed wasn't technical. It was the first full run on the TV, when the candle went out during a quiet stretch and the room's log — deadpan, timestamped — explained that the candle had *always* been unlit. Two people on the couch immediately disagreed about whether it had ever been lit at all. Neither could prove it. The room could. It just wouldn't.

That's the haunting I wanted: not a monster, but a small, polite, well-documented doubt that follows you out of the room.

## Prize Categories

<!-- List only categories that genuinely apply (delete this comment and any that don't): a .tech domain category only if a .tech domain was actually claimed through Hacktoberfest and used for this project; GitHub Copilot only if it was genuinely used. Do not pad. -->
