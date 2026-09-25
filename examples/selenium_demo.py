#!/usr/bin/env python3
"""
Foxmask -> Selenium demo.

Creates a profile via the local Foxmask API, starts it, attaches Selenium to
the running browser through the DevTools port (Options.debugger_address),
opens example.com, prints the title, then stops and deletes the profile.

Requirements (user-side):
    pip install selenium          # >= 4.6; Selenium Manager fetches chromedriver

The Foxmask app (and its local API) must be running. The API port defaults to
35000 -- override with FOXMASK_API_PORT or FOXMASK_API.

Run:
    python examples/selenium_demo.py

Chromedriver note: Selenium Manager downloads a driver matching the *system*
Chrome. Foxmask launches its own Chromium build; on version mismatch, download
a chromedriver matching that Chromium major and pass
Service(executable_path=...) to webdriver.Chrome.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

API = os.environ.get("FOXMASK_API", f"http://127.0.0.1:{os.environ.get('FOXMASK_API_PORT', '35000')}")
HEADERS = {"content-type": "application/json"}


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}/api/v1{path}", data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req) as res:
        payload = json.load(res)
    if not payload.get("success"):
        raise RuntimeError(f"{method} {path} failed: {payload}")
    return payload["data"]


def main() -> None:
    # 1. create a profile -- the fingerprint is generated server-side
    profile = api("POST", "/profiles", {"name": "selenium-demo", "os": "windows"})
    print(f"[demo] created profile {profile['id']} ({profile['fingerprint']['platform']})")

    try:
        # 2. start it -- returns wsEndpoint + debugPort
        started = api("POST", f"/profiles/{profile['id']}/start")
        debug_port = started.get("debugPort")
        if not debug_port:
            raise RuntimeError("launcher returned no debugPort")
        print(f"[demo] started, debugPort={debug_port}")

        # 3. attach to the *running* browser via the DevTools port
        options = Options()
        options.debugger_address = f"127.0.0.1:{debug_port}"
        driver = webdriver.Chrome(options=options)  # attaches; does not launch

        driver.get("https://example.com")
        print(f"[demo] title: {driver.title}")
        # do NOT driver.quit() the attached browser -- stop it via the API instead
    finally:
        # 4. stop + clean up
        api("POST", f"/profiles/{profile['id']}/stop")
        api("DELETE", f"/profiles/{profile['id']}")
        print("[demo] stopped and deleted profile")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as err:
        print(
            f"[demo] cannot reach the Foxmask API at {API}: {err}\n"
            "        Start the Foxmask app first (npm run dev), or point FOXMASK_API_PORT\n"
            "        at the port found in ~/.foxmask/http.port",
            file=sys.stderr,
        )
        sys.exit(1)
