"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Menu, Package, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/sign-out-button";

const NAV_ITEMS = [
  { href: "/analise", label: "Nova análise", icon: Sparkles },
  { href: "/importacoes", label: "Importações", icon: Package },
  { href: "/produtos", label: "Produtos", icon: Boxes },
] as const;

type AppSidebarProps = {
  email: string;
};

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t px-3 py-3">
      <p className="mb-2 truncate px-1 text-xs text-muted-foreground" title={email}>
        {email}
      </p>
      <SignOutButton />
    </div>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b px-4 py-4">
          <Link href="/analise" className="text-lg font-bold tracking-tight">
            Confere.ia
          </Link>
        </div>
        {nav}
        {footer}
      </aside>

      <div className="flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        <Link href="/analise" className="text-lg font-bold tracking-tight">
          Confere.ia
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-60 flex-col border-r bg-card shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <Link
                href="/analise"
                className="text-lg font-bold tracking-tight"
                onClick={() => setOpen(false)}
              >
                Confere.ia
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar menu"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}
    </>
  );
}
