# UI/manual-test launcher: real chat via the global OpenRouter key, but with
# per-user provisioning and SMTP DISABLED so testing is free + frictionless:
#   - no $5 sub-key is minted per registration (chat falls back to the global key)
#   - verification emails are LOGGED (look for "[DEV EMAIL]") instead of sent
# Use _run_local.py instead to exercise the real provisioning + email flow.
import os
from pathlib import Path

for line in Path(".env.production").read_text().splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k, v = s.split("=", 1)
    os.environ[k.strip()] = v.strip()

os.environ["COOKIE_SECURE"] = "false"               # http localhost
os.environ["APP_BASE_URL"] = "http://localhost:8080"  # verify links -> local frontend
os.environ["CORS_ALLOW_ORIGINS"] = "*"
os.environ["DATABASE_PATH"] = "quon.db"
os.environ["OPENROUTER_PROVISIONING_KEY"] = ""       # provisioning OFF -> BYOK/global key
os.environ["SMTP_HOST"] = ""                          # email OFF -> verify links logged

import uvicorn

uvicorn.run("main:app", host="0.0.0.0", port=8000, log_level="info")
