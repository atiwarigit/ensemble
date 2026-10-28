"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/expenses", label: "Expenses" },
  { href: "/expenses/import", label: "Import CSV" },
  { href: "/expenses/reports", label: "Reports" },
  { href: "/expenses/budgets", label: "Budgets" },
  { href: "/expenses/rules", label: "Rules & categories" },
];

export function ExpenseTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Expense sections">
      {TABS.map((t) => {
        const active = t.href === "/expenses" ? pathname === "/expenses" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
