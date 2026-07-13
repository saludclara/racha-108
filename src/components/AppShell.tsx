"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/pick", label: "Pick" },
  { href: "/racha", label: "Racha" },
  { href: "/vault", label: "Vault" },
  { href: "/motor", label: "Motor" },
  { href: "/settings", label: "Ajustes" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <main className="safe-pad flex-1 pb-28 pt-4">{children}</main>
      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-1 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:max-w-3xl">
          {LINKS.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="nav-link"
                data-active={active}
              >
                <span
                  className="h-1 w-1 rounded-full"
                  style={{
                    background: active ? "var(--accent)" : "transparent",
                  }}
                />
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
