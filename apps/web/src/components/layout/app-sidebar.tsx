"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Building2,
  Hash,
  Menu,
  Package,
  Settings,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Brand } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const NAV_ITEMS = [
  { href: "/analise", label: "Nova análise", icon: Sparkles },
  { href: "/importacoes", label: "Importações", icon: Package },
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/ncm", label: "NCM", icon: Hash },
  { href: "/produtos", label: "Produtos", icon: Boxes },
] as const;

const ADMIN_NAV_ITEMS = [
  { href: "/admin", label: "Admin", icon: Shield },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

const FOCUSABLE = "a[href], button:not([disabled])";

type AppSidebarProps = {
  email: string;
  /** Só super-admin (`ADMIN_EMAILS`) vê Admin e Configurações. */
  isSuperAdmin: boolean;
};

export function AppSidebar({ email, isSuperAdmin }: AppSidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

  const items = isSuperAdmin ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement;
    drawerCloseRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [open]);

  const nav = (
    <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 px-3 py-4">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary-soft text-primary-text before:absolute before:-left-3 before:inset-y-1.5 before:w-0.5 before:rounded-full before:bg-primary"
                : "text-secondary-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-primary-text" : "text-muted-foreground",
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-border px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground"
          title={email}
        >
          {email}
        </p>
        <ThemeToggle />
      </div>
      <SignOutButton />
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden h-screen w-60 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Brand />
        </div>
        {nav}
        {footer}
      </aside>

      <div className="flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Brand />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          aria-controls={open ? "mobile-menu" : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside
            id="mobile-menu"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            className="relative z-10 flex h-full w-60 flex-col border-r border-border bg-card shadow-overlay"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Brand onNavigate={() => setOpen(false)} />
              <Button
                ref={drawerCloseRef}
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
