#!/usr/bin/env python3
"""Mint a long-lived Reactor session token for the long-session page.

Same vault-surrogate exchange as the custom.reactor connector helper, but
with a custom lifetime: `expires_after` up to the 6-hour server ceiling and
a per-session duration cap sized for an hour-long Helios run.

Usage:
  python3 mint-long-token.py [model] [expires_after_s] [max_session_s] [max_sessions]
Defaults: reactor/helios, 7200 (2h token), 5400 (90 min sessions), 3 sessions.
Prints the JWT on the last line; the caller decides where it goes
(never commit it, never log it elsewhere).
"""
import json
import sys
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_response_body  # noqa: E402

HOST = "api.reactor.inc"


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else "reactor/helios"
    expires_after = int(sys.argv[2]) if len(sys.argv) > 2 else 7200
    max_session = int(sys.argv[3]) if len(sys.argv) > 3 else 5400
    max_sessions = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    body = {
        "expires_after": expires_after,
        "authorization_details": [
            {
                "type": "session",
                "resources": {"models": {"match": [model]}},
                "constraints": {
                    "max_sessions": max_sessions,
                    "max_session_duration_seconds": max_session,
                },
            }
        ],
    }
    req = urllib.request.Request(
        f"https://{HOST}/tokens", data=json.dumps(body).encode(), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    add_surrogate_to_request(req, "custom.reactor", allowed_hosts=[HOST])
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(read_response_body(resp))
            status = resp.status
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
        sys.exit(1)
    print(f"HTTP {status}")
    print(f"expires_at: {payload.get('expires_at')}")
    print(payload["jwt"])


if __name__ == "__main__":
    main()
