import { redirect } from "next/navigation";
import { resolveAuthState } from "@/lib/auth";
import { AppSidebar } from "./app-sidebar";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const state = await resolveAuthState();
  if (state.status !== "authenticated") redirect("/login");

  const ctx = state.context;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar email={ctx.email ?? ""} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
