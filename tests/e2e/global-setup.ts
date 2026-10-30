import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";

import { CREDS_FILE, laneKey, registerAndVerify, type Creds } from "./helpers/account";
import config from "../../playwright.config";

/** Create + verify the suite's accounts. Runs after the webServers are up.
 *
 *  One pre-verified account per RUN LANE = (browser project × worker slot), so
 *  no two lanes ever share mutable account state. Keying on the worker alone
 *  used to let the chromium and webkit projects collide on slot 0 in a serial
 *  run, which leaked SYNCED prefs (protection level!) across projects — see
 *  `sharedCreds` for the failure it caused.
 *
 *  The FIRST account registered on the fresh instance bootstraps as the
 *  instance ADMIN (users.role) — it is deliberately NOT any lane's account;
 *  admin.spec uses it via adminCreds(). */
export const WORKER_ACCOUNTS = 4;

export default async function globalSetup(): Promise<void> {
  const admin: Creds = { email: "admin@quon.test", password: "Adm1n-E2E-Secret!" };
  const projects = (config.projects ?? []).map((p) => p.name ?? "default");
  const workers: Creds[] = projects.flatMap((project) =>
    Array.from({ length: WORKER_ACCOUNTS }, (_, i) => ({
      email: `shared-${laneKey(project, i)}@quon.test`,
      password: "Sh4red-E2E-Secret!",
    })),
  );
  // review-mode.spec flips Review — a SYNCED pref — so it gets accounts of its
  // own, keeping that state out of the lane accounts entirely (per-test cleanup
  // can't undo it: `prefs` is one blob, see sharedCreds). PER LANE, not one
  // global one: with parallel workers the two browser projects would otherwise
  // run this spec CONCURRENTLY on the same account and fight over the pref —
  // measured, it failed exactly that way at QUON_E2E_WORKERS=2.
  const reviewers: Creds[] = projects.flatMap((project) =>
    Array.from({ length: WORKER_ACCOUNTS }, (_, i) => ({
      email: `review-${laneKey(project, i)}@quon.test`,
      password: "Rev1ew-E2E-Secret!",
    })),
  );

  const browser = await chromium.launch();
  // Pin English (like the rest of the suite — playwright.config.ts) so the shared
  // account registers in English and its stored ui_language matches; otherwise
  // the language would follow Playwright's navigator locale non-deterministically.
  const context = await browser.newContext({
    // From the config, not restated — the port is per-checkout now.
    baseURL: config.use!.baseURL as string,
    storageState: {
      cookies: [
        {
          name: "quon_lang",
          value: "en",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
  const page = await context.newPage();
  try {
    await registerAndVerify(page, admin); // FIRST → instance admin (role bootstrap)
    for (const w of [...workers, ...reviewers]) await registerAndVerify(page, w);
  } finally {
    await browser.close();
  }

  mkdirSync("tests/e2e/.auth", { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify({ admin, workers, reviewers }));
}
