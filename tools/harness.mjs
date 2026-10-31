// DOM-stub harness for app.js — runs the burst engine end-to-end in Node.
// Usage: node tools/harness.mjs   (timers are compressed; a real burst is 6.2s)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const elements = {};
function makeEl(id) {
  const el = {
    id, children: [], hidden: false, textContent: '', innerHTML: '',
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
    },
    listeners: {},
    addEventListener(k, f) { (this.listeners[k] ||= []).push(f); },
    appendChild(c) { this.children.push(c); },
    prepend(c) { this.children.unshift(c); },
    setAttribute() {}, removeAttribute() {}, load() {}, pause() {},
    play() { return Promise.resolve(); },
  };
  elements[id] = el;
  return el;
}
const scene = makeEl('scene');
['modeBadge', 'costReadout', 'nextReadout', 'eventLog', 'logPanel', 'livePanel', 'ariaStatus',
 'liveStatus', 'burstBtn', 'resetBtn', 'logBtn', 'liveBtn', 'closeLiveBtn', 'fullBtn', 'paceBtn',
 'burstVideo', 'burstFx'].forEach(makeEl);

global.document = {
  getElementById: (id) => elements[id] || makeEl(id),
  createElement: () => makeEl('anon' + Math.random()),
  createTextNode: (t) => ({ textContent: t }),
  addEventListener() {},
  documentElement: { requestFullscreen() {} },
};
Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
global.window = global;
const realSetTimeout = setTimeout;
global.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms, 30));
global.setInterval = () => 0;
global.clearInterval = () => {};

eval(fs.readFileSync(join(root, 'app.js'), 'utf8'));

await elements['burstBtn'].listeners['click'][0]();
await new Promise((r) => realSetTimeout(r, 250));

const logItems = elements['eventLog'].children.length;
const changed = [...scene.classList._s].filter((c) => c.startsWith('changed-'));
console.log(JSON.stringify({ logItems, changedClasses: changed, costText: elements['costReadout'].textContent }, null, 2));
if (logItems < 1) { console.error('FAIL: no denial logged after burst'); process.exit(1); }
if (changed.length < 1) { console.error('FAIL: no gaslight change persisted'); process.exit(1); }
console.log('HARNESS PASS');
process.exit(0);
