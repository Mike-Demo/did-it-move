#!/usr/bin/env python3
"""Build capture-standalone.html: capture.html with the room image embedded
as a data URI, so the whole capture kit is one file that can be opened from
any machine (e.g. inside a Windows 365 Cloud PC browser).

Usage: python3 build-standalone.py [capture.html] [room-source.png] [out.html]
"""
import base64
import pathlib
import sys

here = pathlib.Path(__file__).parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "capture.html"
img = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else here / "room-source.png"
out = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else here / "capture-standalone.html"

html = src.read_text()
data_uri = "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode()
inject = f'<script>window.ROOM_SOURCE_DATA_URI = "{data_uri}";</script>\n<script type="module">'
html = html.replace('<script type="module">', inject, 1)
out.write_text(html)
print(f"wrote {out} ({out.stat().st_size} bytes)")
