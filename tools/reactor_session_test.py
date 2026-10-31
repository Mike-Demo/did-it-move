#!/usr/bin/env python3
"""One short Reactor session: connect, publish synthetic frames, set a prompt,
count output frames, try a clip download, disconnect. Hard budget ~120s.

The JWT is minted through the vault connector helper and held in memory only.
"""
import asyncio
import json
import subprocess
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path.home() / "workspace/.pip-packages"))
import numpy as np  # noqa: E402
from reactor_sdk import Reactor  # noqa: E402

HELPER = str(__import__("pathlib").Path.home() / "workspace/custom-connectors/custom.reactor/bin/reactor-api")
MODEL = "reactor/xmax-x2-1"


def mint_jwt():
    out = subprocess.run([HELPER, "mint-token", MODEL], capture_output=True, text=True, timeout=120)
    lines = out.stdout.strip().splitlines()
    assert lines and lines[0] == "HTTP 200", f"mint failed: {out.stdout[:200]} {out.stderr[:200]}"
    return json.loads(lines[1])["jwt"]


def make_frame(t):
    h, w = 360, 640
    y = np.linspace(30, 90, h, dtype=np.uint8)[:, None, None]
    x = np.linspace(0, 30, w, dtype=np.uint8)[None, :, None]
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    frame[..., 0] = np.clip(y + x, 0, 255)          # warm dark red-brown
    frame[..., 1] = np.clip(y // 2 + x // 2, 0, 255)
    frame[..., 2] = np.clip(y // 3, 0, 255)
    # a "fireplace" glow block that flickers with t
    glow = 140 + int(40 * np.sin(t * 7))
    frame[240:330, 270:370] = [glow, glow // 2, 20]
    return frame


async def main():
    jwt = mint_jwt()
    print("JWT minted OK", flush=True)
    reactor = Reactor(model_name=MODEL, jwt=jwt)
    received = {"n": 0}
    try:
        await asyncio.wait_for(reactor.connect(), timeout=90)
        print("CONNECTED; tracks:", [t.name for t in reactor.tracks], flush=True)
        out_track = reactor.track("main_video")

        @out_track.on_frame
        def _count(frame):
            received["n"] += 1

        source = await reactor.publish_track("source")
        print("source published", flush=True)
        reply = await reactor.send_command("set_prompt", {"prompt": "A cozy living room at night. The candle flame gutters and goes out. Everything else stays still."})
        print("set_prompt reply:", str(reply)[:200], flush=True)
        t0 = time.time()
        while time.time() - t0 < 20:
            source.push_frame(make_frame(time.time() - t0))
            await asyncio.sleep(0.1)
        print(f"pushed 20s of frames; received {received['n']} output frames", flush=True)
        try:
            await asyncio.wait_for(reactor.download_clip(8, "/tmp/reactor-test-clip.ts"), timeout=60)
            print("clip downloaded to /tmp/reactor-test-clip.ts", flush=True)
        except Exception as e:
            print("clip download failed:", type(e).__name__, str(e)[:200], flush=True)
    finally:
        try:
            await reactor.disconnect()
            print("disconnected (session ended)", flush=True)
        except Exception as e:
            print("disconnect error:", type(e).__name__, str(e)[:120], flush=True)


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=240))
