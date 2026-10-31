#!/usr/bin/env node
/*
 * capture-bursts.mjs — generate the pre-recorded burst clips via OpenRouter.
 *
 * OpenRouter's video API is asynchronous and per-clip priced:
 *   POST /api/v1/videos  ->  poll GET /api/v1/videos/{id}  ->  download MP4
 * There is no session and no idle billing — you pay for output seconds only,
 * which is exactly the right shape for capturing bursts ONCE during
 * development and replaying them at $0 per visitor afterwards.
 *
 * Usage:
 *   node tools/capture-bursts.mjs                 # dry run: payloads + cost estimate, no charges
 *   OPENROUTER_API_KEY=sk-or-... node tools/capture-bursts.mjs --live
 *   node tools/capture-bursts.mjs --live --model google/veo-3.1-lite --resolution 720p --takes 3
 *
 * Frame control: if FRAME_BASE_URL is set to a public base URL, the tool sends
 *   <FRAME_BASE_URL>/<event>-first.png  and  <event>-last.png
 * as first/last frames (screenshot the room before/after the change) for
 * models that support both. Otherwise it generates text-to-video.
 *
 * Guardrails baked in (Demo's standing rules):
 *   - x-ai/* models are refused (no SpaceX/xAI), even though Grok Lite is cheap.
 *   - openrouter/auto is refused — pin a model, always.
 *   - Use a DEDICATED OpenRouter key for this project with its own low cap.
 *     Do NOT reuse the QueerCade Oracle key ($50 cap, lapses ~2026-11-22).
 *   - Job IDs are persisted to bursts/jobs.json BEFORE polling, so a crashed
 *     run resumes instead of paying for duplicate generations.
 *
 * Prices below were read from GET https://openrouter.ai/api/v1/videos/models
 * on 2026-10-28. Estimates are planning numbers, not quotes.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const EVENTS = [
  { id: 'portrait', prompt: "A cozy living room at night, locked-off camera. The eyes in the framed portrait shift very slowly to look toward the sofa. Nothing else moves. Subtle, photorealistic, no camera movement, no people." },
  { id: 'shadow', prompt: "A cozy living room at night, locked-off camera. A tall human-shaped shadow passes slowly across the moonlit window, outside the glass. Nothing inside the room changes. Subtle, photorealistic." },
  { id: 'chair', prompt: "A cozy living room at night, locked-off camera. An empty wooden rocking chair rocks gently on its own, slows, and comes to rest facing the other way. No person appears. Subtle, photorealistic." },
  { id: 'candle', prompt: "A cozy living room at night, locked-off camera. A candle flame gutters, leans as if someone breathed beside it, and goes out, leaving a thin line of smoke. Everything else stays still. Subtle, photorealistic." },
  { id: 'picture', prompt: "A cozy living room at night, locked-off camera. A small framed picture on the wall tilts very slowly, a few degrees, as if its nail slipped, then stops. Nothing else moves. Subtle, photorealistic." },
  { id: 'book', prompt: "A cozy living room at night, locked-off camera. One book on a bookshelf slides a few centimetres out, pauses, then drops softly to the floor. Nothing else moves. Subtle, photorealistic." },
  { id: 'mirror', prompt: "A cozy living room at night, locked-off camera. Inside the wall mirror only, a still blurred figure stands behind the sofa for a few seconds, then is gone. The room itself remains empty. Subtle, photorealistic." },
];

// USD per output second, no audio, from the live catalog (2026-10-28).
const PRICES = {
  'bytedance/seedance-1-5-pro': { '480p': 0.01153, '720p': 0.02306, note: 'token-priced; per-sec figures are the model-page approximations' },
  'google/veo-3.1-lite': { '720p': 0.03, '1080p': 0.05, note: 'first+last frame, 4/6/8s only' },
  'alibaba/wan-3.0': { '480p': 0.05, '720p': 0.10, '1080p': 0.20, note: 'open-weight lineage (Wan family)' },
  'minimax/hailuo-3-max': { '480p': 0.05, '768p': 0.08, note: 'first+last frame' },
  'alibaba/wan-2.7': { '720p': 0.10, note: 'first+last frame, flat per-sec SKU' },
};

const args = process.argv.slice(2);
const live = args.includes('--live');
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const model = opt('model', 'bytedance/seedance-1-5-pro');
const resolution = opt('resolution', '480p');
const duration = Number(opt('duration', '6'));
const takes = Number(opt('takes', '1'));
const only = opt('only', '');

if (model.startsWith('x-ai/')) {
  console.error('REFUSED: x-ai/* is excluded by the no-SpaceX/xAI rule. Pick another model.');
  process.exit(2);
}
if (model.includes('auto')) {
  console.error('REFUSED: never route video jobs through an auto router. Pin a model.');
  process.exit(2);
}
const price = PRICES[model]?.[resolution];
if (!price) {
  console.error(`No checked price for ${model} @ ${resolution}. Add it to PRICES from the live catalog first — do not guess.`);
  process.exit(2);
}

const events = only ? EVENTS.filter((e) => e.id === only) : EVENTS;
const perClip = price * duration;
const total = perClip * events.length * takes;
console.log(`Model: ${model} @ ${resolution}, ${duration}s, no audio (${PRICES[model].note})`);
console.log(`Estimate: $${perClip.toFixed(3)}/clip × ${events.length} events × ${takes} take(s) = $${total.toFixed(2)}`);

const frameBase = process.env.FRAME_BASE_URL || '';
function payloadFor(ev) {
  const body = {
    model,
    prompt: ev.prompt,
    duration,
    resolution,
    aspect_ratio: '16:9',
    generate_audio: false,
  };
  if (frameBase) {
    body.frame_images = [
      { type: 'image_url', image_url: { url: `${frameBase}/${ev.id}-first.png` }, frame_type: 'first_frame' },
      { type: 'image_url', image_url: { url: `${frameBase}/${ev.id}-last.png` }, frame_type: 'last_frame' },
    ];
  }
  return body;
}

if (!live) {
  for (const ev of events) console.log(`\n[dry-run] ${ev.id}:`, JSON.stringify(payloadFor(ev)));
  console.log('\nDry run only — nothing submitted, nothing charged. Re-run with --live and OPENROUTER_API_KEY set.');
  process.exit(0);
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set. Use a dedicated key for this project (not the QueerCade Oracle key).');
  process.exit(2);
}

await mkdir('bursts', { recursive: true });
const jobsPath = 'bursts/jobs.json';
let jobs = existsSync(jobsPath) ? JSON.parse(await readFile(jobsPath, 'utf8')) : {};
const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submit(ev, take) {
  const key = `${ev.id}-take${take}`;
  if (jobs[key]?.id) {
    console.log(`${key}: resuming job ${jobs[key].id} (already submitted — not paying twice)`);
    return jobs[key].id;
  }
  const res = await fetch('https://openrouter.ai/api/v1/videos', {
    method: 'POST', headers, body: JSON.stringify(payloadFor(ev)),
  });
  if (!res.ok) throw new Error(`${key}: submit failed ${res.status} ${await res.text()}`);
  const job = await res.json();
  jobs[key] = { id: job.id, status: job.status, model, resolution, duration };
  await writeFile(jobsPath, JSON.stringify(jobs, null, 2)); // persist BEFORE polling
  console.log(`${key}: submitted ${job.id}`);
  return job.id;
}

async function pollAndDownload(ev, take) {
  const key = `${ev.id}-take${take}`;
  const id = await submit(ev, take);
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`https://openrouter.ai/api/v1/videos/${id}`, { headers });
    if (!res.ok) throw new Error(`${key}: poll failed ${res.status}`);
    const job = await res.json();
    if (job.status === 'completed') {
      const url = job.unsigned_urls?.[0];
      if (!url) throw new Error(`${key}: completed but no unsigned_urls in response`);
      const file = `bursts/${key}.mp4`;
      const vid = await fetch(url, { headers });
      if (!vid.ok) throw new Error(`${key}: download failed ${vid.status}`);
      await writeFile(file, Buffer.from(await vid.arrayBuffer()));
      jobs[key].status = 'downloaded';
      await writeFile(jobsPath, JSON.stringify(jobs, null, 2));
      console.log(`${key}: saved ${file}`);
      return file;
    }
    if (['failed', 'cancelled', 'expired'].includes(job.status)) {
      throw new Error(`${key}: job ${job.status} ${job.error ?? ''}`);
    }
    await sleep(30000);
  }
  throw new Error(`${key}: timed out after 15 minutes (job id kept in bursts/jobs.json)`);
}

for (const ev of events) {
  for (let t = 1; t <= takes; t++) await pollAndDownload(ev, t);
}
console.log(`Done. Rename the best take of each event to bursts/<event>.mp4 — the app plays that file when present.`);
