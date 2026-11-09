import { test, expect } from "@playwright/test";

import { login, registerAndVerify, type Creds } from "./helpers/account";

// Per-project chat defaults (projectChatDefaults.ts + ScreenProjects edit card +
// ScreenChat seed). A project's default protection SEEDS a chat opened in it, while
// a global new chat keeps the global default. Uses a FRESH account so the global
// default protection is deterministically "local" (Filter, Review off) - the shared
// account's protectionLevel is mutated by other specs.
const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

test("project default 'Review' seeds the Review pill; a global chat does not", async ({ page }) => {
  test.slow(); // fresh-account register + Argon2 login

  const creds: Creds = { email: `projdef-${uniq()}@quon.test`, password: "e2e-password-123456" };
  await registerAndVerify(page, creds);
  await login(page, creds);

  // Baseline: a global new chat uses the global default (Filter on, Review off).
  await page.goto("/chat");
  const reviewPill = page.getByRole("button", { name: "Review", exact: true });
  await expect(reviewPill).toBeVisible({ timeout: 30_000 });
  await expect(reviewPill).toHaveAttribute("aria-pressed", "false");

  // Create a project and set its default Protection = "Review".
  const name = `Defaults ${uniq()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\?id=/, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("id")!;

  // Chat defaults live in the Settings tab, behind a collapsed disclosure
  // (badge shows "Using global defaults" / "N custom").
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Chat defaults/ }).click();

  // The Protection select sits under its own "Protection" label in the Chat-defaults
  // grid; open it and pick the Review option, then Save changes.
  // The Protection field is the div wrapping the "Protection" label + its combobox
  // (walk up from the label span to its immediate parent).
  const protectionSelect = page
    .getByText("Protection", { exact: true })
    .locator("xpath=..")
    .getByRole("combobox");
  await protectionSelect.click();
  await page.getByRole("option", { name: /Review — approve before send/ }).click();
  await page.getByRole("button", { name: /Save changes/ }).click();
  await expect(page.getByRole("button", { name: /^Saved$/ })).toBeVisible({ timeout: 30_000 });

  // Persistence sanity: reopening the project shows the Protection select on Review
  // (fresh load -> Overview tab; walk back into the disclosure).
  await page.goto(`/projects?id=${projectId}`);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Chat defaults/ }).click();
  await expect(
    page.getByText("Protection", { exact: true }).locator("xpath=..").getByRole("combobox"),
  ).toContainText(/Review/, { timeout: 30_000 });

  // Start a new chat IN the project via the project's own "New chat" link (on the
  // Overview tab) - an in-app (client-side) navigation, so the just-loaded project
  // store is warm when the seed runs (a cold /chat?p= reload can race the async
  // project hydration).
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("link", { name: "New chat" }).click();
  await expect(page).toHaveURL(new RegExp(`/chat\\?p=${projectId}`), { timeout: 30_000 });

  // The chat is seeded to Review -> the Review pill is pressed.
  const projReviewPill = page.getByRole("button", { name: "Review", exact: true });
  await expect(projReviewPill).toBeVisible({ timeout: 30_000 });
  await expect(projReviewPill).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
});
