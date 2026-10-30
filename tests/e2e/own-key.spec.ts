import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Feedback #84 / #91: after the budget banner two users pasted a key from
 * another vendor under Settings → Providers. The override wins over the
 * included key, so every chat failed with a misleading "key rejected" until
 * they removed it. The key is now verified when saved: a non-OpenRouter key
 * is refused on the spot and nothing is stored.
 */
test("a key from another vendor is refused at save time, with the reason", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Providers" }).click();

  const field = page.getByPlaceholder("sk-or-v1-…");
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill("sk-ant-api03-this-is-not-an-openrouter-key");
  await page.getByRole("button", { name: "Save key" }).click();

  await expect(page.getByText(/not an OpenRouter key/)).toBeVisible({ timeout: 30_000 });
  // Nothing was stored: the field still offers the empty placeholder, not "set".
  await expect(page.getByPlaceholder("sk-or-v1-…")).toBeVisible();
  await expect(page.getByText("Saved")).toHaveCount(0);
});

/** The user can take an own key back from the card (#91): before, saving an
 *  empty field did nothing and a wrong key stayed in force for good. Hermetic —
 *  the settings read is mocked to say an own key is in use. */
test("an own key can be removed from the card; the included key is used again", async ({
  page,
}) => {
  let ownKey = true;
  let clearedWith: string | null = null;
  // "**/settings" also matches the app's own /settings PAGE — only the API
  // fetch is rewritten, the document navigation passes through untouched.
  await page.route("**/settings", async (route) => {
    const req = route.request();
    if (req.method() !== "GET" || !["fetch", "xhr"].includes(req.resourceType())) {
      return route.fallback();
    }
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, own_openrouter_key: ownKey } });
  });
  await page.route("**/settings/openrouter-key", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    clearedWith = JSON.parse(route.request().postData() ?? "{}").api_key ?? null;
    ownKey = false;
    const res = await route.fetch(); // the real clear (nothing was stored) → real settings body
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, own_openrouter_key: false } });
  });

  await login(page, sharedCreds());
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Providers" }).click();
  await expect(page.getByText("Your own key is in use")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByText(/Key removed/)).toBeVisible({ timeout: 30_000 });
  expect(clearedWith).toBe("");
  await expect(page.getByText("Your own key is in use")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove key" })).toHaveCount(0);
});
