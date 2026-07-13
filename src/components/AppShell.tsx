"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/", label: "Inicio", icon: "⌂" },
  { href: "/pick", label: "Pick", icon: "◎" },
  { href: "/racha", label: "Racha", icon: "✦" },
  { href: "/vault", label: "Vault", icon: "◈" },
  { href: "/motor", label: "Motor", icon: "⌘" },
  { href: "/settings", label: "Ajustes", icon: "⚙" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-xl">
      <main className="safe-pad flex-1 pb-28 pt-2">{children}</main>
      <nav className="ios-tabbar fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 md:max-w-xl">
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
                <span className="nav-icon" aria-hidden>
                  {l.icon}
                </span>
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
