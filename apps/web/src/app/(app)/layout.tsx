import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSearch } from "lucide-react";
import { resolveAuthState } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

const NAV_ITEMS = [
  { href: "/analise", label: "Análise", icon: FileSearch },
] as const;

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const state = await resolveAuthState();
  if (state.status !== "authenticated") redirect("/login");

  const ctx = state.context;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="border-b p-4">
          <Link href="/analise" className="text-lg font-bold">
            Confere.ia
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-4">
          <p className="mb-2 truncate text-xs text-muted-foreground">
            {ctx.email}
          </p>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
