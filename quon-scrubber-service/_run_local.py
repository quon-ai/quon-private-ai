# Local test launcher: production secrets from .env.production + local overrides.
import os
from pathlib import Path
for line in Path(".env.production").read_text().splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s: continue
    k, v = s.split("=", 1); os.environ[k.strip()] = v.strip()
os.environ["COOKIE_SECURE"] = "false"            # http localhost
os.environ["APP_BASE_URL"] = "http://localhost:8080"   # verify links -> local
os.environ["CORS_ALLOW_ORIGINS"] = "*"
os.environ["DATABASE_PATH"] = "quon.db"
import uvicorn
uvicorn.run("main:app", host="0.0.0.0", port=8000, log_level="info")
