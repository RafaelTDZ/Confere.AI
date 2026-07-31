import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveAuthState } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const state = await resolveAuthState();
  if (state.status !== "authenticated") redirect("/login");

  const ctx = state.context;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <Link href="/analise" className="text-lg font-bold">
            Confere.ia
          </Link>
          <div className="flex items-center gap-3">
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {ctx.email}
            </p>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
