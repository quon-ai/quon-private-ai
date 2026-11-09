import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { logout } from "@/lib/authStore";
import { AppShell } from "@/components/quon/AppShell";
import { ScreenSettings } from "@/components/quon/ScreenSettings";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — QUON" },
      { name: "description", content: "Manage your connected models and account." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  // Real sign-out: terminate the server session + drop the in-memory Master Key
  // (status -> anonymous, which flips the shell to the sign-in screen). The old
  // implementation only cleared a stale localStorage key and reloaded, leaving the
  // httpOnly session cookie intact - so the reload landed back in the app.
  async function handleLogout() {
    await logout();
    navigate({ to: "/" });
  }
  return (
    <AppShell>
      <ScreenSettings onLogout={handleLogout} />
    </AppShell>
  );
}
