import { redirect } from "next/navigation";
import { resolveAuthState } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/settings/ai-settings";
import { AppSidebar } from "@/components/layout/app-sidebar";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const state = await resolveAuthState();
  if (state.status !== "authenticated") redirect("/login");

  const ctx = state.context;

  return (
    <div className="min-h-screen md:pl-60">
      <AppSidebar email={ctx.email ?? ""} isAdmin={isSuperAdmin(ctx.email)} />
      <main className="min-h-screen p-4 md:p-8">{children}</main>
    </div>
  );
}
