#!/usr/bin/env python3
"""Submit/poll/download OpenRouter burst jobs through the vault connector helper.

The API key never touches this process: every call goes through
~/workspace/custom-connectors/custom.openrouter/bin/openrouter-api, which
attaches the stored credential via surrogate exchange.

Job IDs are persisted to bursts/jobs.json before polling, so re-running
resumes instead of paying for duplicate generations.

Usage:
  python3 tools/capture_via_connector.py --event portrait --takes 3
  python3 tools/capture_via_connector.py --event chair --takes 1 --model google/veo-3.1-lite --resolution 720p --duration 8
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HELPER = str(Path.home() / "workspace/custom-connectors/custom.openrouter/bin/openrouter-api")
ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "bursts" / "jobs.json"

PROMPTS = {
    "portrait": "A cozy living room at night, locked-off camera. The eyes in the framed portrait shift very slowly to look toward the sofa. Nothing else moves. Subtle, photorealistic, no camera movement, no people.",
    "shadow": "A cozy living room at night, locked-off camera. A tall human-shaped shadow passes slowly across the moonlit window, outside the glass. Nothing inside the room changes. Subtle, photorealistic.",
    "chair": "A cozy living room at night, locked-off camera. An empty wooden rocking chair rocks gently on its own, slows, and comes to rest facing the other way. No person appears. Subtle, photorealistic.",
    "candle": "A cozy living room at night, locked-off camera. A candle flame gutters, leans as if someone breathed beside it, and goes out, leaving a thin line of smoke. Everything else stays still. Subtle, photorealistic.",
    "picture": "A cozy living room at night, locked-off camera. A small framed picture on the wall tilts very slowly, a few degrees, as if its nail slipped, then stops. Nothing else moves. Subtle, photorealistic.",
    "book": "A cozy living room at night, locked-off camera. One book on a bookshelf slides a few centimetres out, pauses, then drops softly to the floor. Nothing else moves. Subtle, photorealistic.",
    "mirror": "A cozy living room at night, locked-off camera. Inside the wall mirror only, a still blurred figure stands behind the sofa for a few seconds, then is gone. The room itself remains empty. Subtle, photorealistic.",
}

REFUSED_PREFIXES = ("x-ai/",)  # Demo's standing rule: no SpaceX/xAI models


def helper(*args):
    out = subprocess.run([HELPER, *args], capture_output=True, text=True, timeout=600)
    lines = out.stdout.strip().splitlines()
    if not lines or not lines[0].startswith("HTTP "):
        raise RuntimeError(f"helper {' '.join(args)} failed: rc={out.returncode} out={out.stdout!r} err={out.stderr!r}")
    status = int(lines[0].split()[1])
    return status, "\n".join(lines[1:])


def load_jobs():
    if JOBS.exists():
        return json.loads(JOBS.read_text())
    return {}


def save_jobs(jobs):
    JOBS.parent.mkdir(parents=True, exist_ok=True)
    JOBS.write_text(json.dumps(jobs, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True, choices=sorted(PROMPTS))
    ap.add_argument("--takes", type=int, default=1)
    ap.add_argument("--model", default="bytedance/seedance-1-5-pro")
    ap.add_argument("--resolution", default="480p")
    ap.add_argument("--duration", type=int, default=6)
    a = ap.parse_args()

    if a.model.startswith(REFUSED_PREFIXES) or "auto" in a.model:
        print(f"REFUSED model {a.model}: excluded by project guardrails")
        return 2

    jobs = load_jobs()
    body = {
        "model": a.model,
        "prompt": PROMPTS[a.event],
        "duration": a.duration,
        "resolution": a.resolution,
        "aspect_ratio": "16:9",
        "generate_audio": False,
    }

    for take in range(1, a.takes + 1):
        key = f"{a.event}-take{take}"
        entry = jobs.get(key)
        if not entry or not entry.get("id"):
            with open("/tmp/dim-body.json", "w") as f:
                json.dump(body, f)
            status, text = helper("submit-video", "/tmp/dim-body.json")
            print(f"{key}: submit HTTP {status}: {text[:300]}", flush=True)
            if status >= 300:
                print(f"{key}: SUBMIT FAILED, stopping")
                return 1
            job = json.loads(text)
            entry = {"id": job["id"], "status": job.get("status"), "model": a.model,
                     "resolution": a.resolution, "duration": a.duration}
            jobs[key] = entry
            save_jobs(jobs)  # persist BEFORE polling
            print(f"{key}: job id saved {entry['id']}", flush=True)

        out_file = ROOT / "bursts" / f"{key}.mp4"
        if out_file.exists() and jobs[key].get("status") == "downloaded":
            print(f"{key}: already downloaded, skipping", flush=True)
            continue

        deadline = time.time() + 15 * 60
        while time.time() < deadline:
            status, text = helper("poll-video", entry["id"])
            job = json.loads(text)
            st = job.get("status")
            print(f"{key}: poll -> {st}", flush=True)
            if st == "completed":
                r = subprocess.run([HELPER, "download-video", entry["id"], str(out_file)],
                                   capture_output=True, text=True, timeout=600)
                print(f"{key}: {r.stdout.strip()} {r.stderr.strip()}", flush=True)
                if r.returncode != 0:
                    return 1
                jobs[key]["status"] = "downloaded"
                save_jobs(jobs)
                break
            if st in ("failed", "cancelled", "expired"):
                print(f"{key}: terminal {st}: {job.get('error')}")
                return 1
            time.sleep(30)
        else:
            print(f"{key}: timed out after 15 min (job id kept in bursts/jobs.json)")
            return 1
    print("ALL TAKES DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
