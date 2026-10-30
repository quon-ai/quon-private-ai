import { test, expect, type Page } from "@playwright/test";

import { login, openChat, sharedCreds } from "./helpers/account";

// Echoing + delayed relay mock: the reply echoes the last user content (so every
// message gets a DISTINCT reply — that's how we detect "all bubbles overwritten with
// the last answer"), after `delayMs` (a window to interact mid-generation).
async function mockRelay(page: Page, delayMs: number) {
  await page.route("**/chat/stream", async (route) => {
    let reply = "Echo: ?";
    try {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((m: { role: string }) => m.role === "user");
      reply = `Echo: ${lastUser?.content ?? "?"}`;
    } catch {
      /* keep default */
    }
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: reply })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
}

const box = (page: Page) => page.getByPlaceholder("Ask anything, keep your data personal");
const send = (page: Page) => page.getByRole("button", { name: "Send" }).click();
// the chat bubbles live in <main>; the sidebar Recents list does not — scope to it so a
// Recents entry titled like a message isn't mistaken for a bubble.
const main = (page: Page) => page.locator("main");

test("multiple messages in one chat keep their own distinct replies", async ({ page }) => {
  await mockRelay(page, 200);
  await login(page, sharedCreds());
  await openChat(page);

  for (const m of ["alpha one", "bravo two", "charlie three"]) {
    await box(page).fill(m);
    await send(page);
    await expect(main(page).getByText(`Echo: ${m}`)).toBeVisible({ timeout: 60_000 });
  }
  // BUG 1: no earlier reply was overwritten by a later one.
  for (const m of ["alpha one", "bravo two", "charlie three"]) {
    await expect(main(page).getByText(`Echo: ${m}`)).toHaveCount(1);
  }
});

test("New chat pressed mid-generation gives a clean, separate chat", async ({ page }) => {
  await mockRelay(page, 1500);
  await login(page, sharedCreds());
  await openChat(page);

  await box(page).fill("first chat message");
  await send(page);
  // TRUE sync point: wait for the send to have COMMITTED its session (?c= in
  // the URL). The old bubble-text wait was a false signal — getByText matched
  // the COMPOSER's text inside <main> while the scrub was still in flight, so
  // "New chat" got clicked mid-scrub, its /chat→/chat navigation was a no-op,
  // and the send's own ?c= navigation then erased the press entirely (proven
  // via trace + console instrumentation). The mock stream is still ~1.5s from
  // finishing here, so the press below remains genuinely mid-GENERATION.
  await page.waitForURL(/\?c=/);
  await expect(main(page).getByText("first chat message")).toBeVisible(); // generating

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  // The navigation must actually land (URL loses ?c=<old session>) before the
  // second message goes out — toHaveValue("") alone is a no-op sync point (the
  // composer is already empty after send #1).
  await expect(page).toHaveURL(/\/chat$/);
  await expect(box(page)).toHaveValue("");

  await box(page).fill("second chat message");
  await send(page);
  await expect(main(page).getByText("Echo: second chat message")).toBeVisible({ timeout: 60_000 });

  // BUG 2: the new chat's transcript holds ONLY its own turn.
  await expect(main(page).getByText("first chat message")).toHaveCount(0);
  await expect(main(page).getByText("Echo: first chat message")).toHaveCount(0);
});

test("pressing + mid-generation, then returning to the chat, keeps distinct replies", async ({
  page,
}) => {
  await mockRelay(page, 1200);
  await login(page, sharedCreds());
  await openChat(page);

  await box(page).fill("returnflow alpha");
  await send(page);
  await expect(main(page).getByText("returnflow alpha")).toBeVisible(); // generating

  // The user's exact trigger: press + a few times during generation.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();

  // Return to the first chat via Recents and let its reply finish.
  await page.getByRole("link", { name: "returnflow alpha", exact: true }).click();
  await expect(main(page).getByText("Echo: returnflow alpha")).toBeVisible({ timeout: 60_000 });

  // Send a second message in that same chat.
  await box(page).fill("returnflow bravo");
  await send(page);
  await expect(main(page).getByText("Echo: returnflow bravo")).toBeVisible({ timeout: 60_000 });

  // BUG 1 (the overwrite): both replies must coexist, distinct, exactly once.
  await expect(main(page).getByText("Echo: returnflow alpha")).toHaveCount(1);
  await expect(main(page).getByText("Echo: returnflow bravo")).toHaveCount(1);
});

test("a new chat is immediately sendable while another chat is still generating", async ({
  page,
}) => {
  await mockRelay(page, 3000); // first request keeps generating
  await login(page, sharedCreds());
  await openChat(page);

  await box(page).fill("slow background request");
  await send(page);
  await expect(main(page).getByText("slow background request")).toBeVisible();
  // confirm the first chat is generating (its Send turned into Stop)
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();

  // Switch to a new chat — it must NOT inherit the generating state.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);

  // ...and a second request can go out right away (concurrent background generation).
  await box(page).fill("second concurrent request");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await send(page);
  await expect(main(page).getByText("Echo: second concurrent request")).toBeVisible({
    timeout: 60_000,
  });
});

test("distinct replies survive a full page reload (persisted ids stay unique)", async ({
  page,
}) => {
  await mockRelay(page, 200);
  await login(page, sharedCreds());
  await openChat(page);

  for (const m of ["reload uno", "reload dos"]) {
    await box(page).fill(m);
    await send(page);
    await expect(main(page).getByText(`Echo: ${m}`)).toBeVisible({ timeout: 60_000 });
  }
  await page.reload();

  // After re-hydrating from the persisted session, both replies are still present and
  // distinct — a duplicate persisted id would collapse them on reload.
  await expect(main(page).getByText("Echo: reload uno")).toHaveCount(1);
  await expect(main(page).getByText("Echo: reload dos")).toHaveCount(1);
});
