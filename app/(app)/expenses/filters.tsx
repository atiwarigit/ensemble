"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Option } from "./data";

export function ExpenseFilters({
  projects,
  categories,
  showSearch = true,
  showCategory = true,
  defaultMonth,
}: {
  projects: Option[];
  categories?: Option[];
  showSearch?: boolean;
  showCategory?: boolean;
  /** Shown when no month filter is set (e.g. the report's end month). */
  defaultMonth?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next}`);
  }

  const active = ["project", "category", "month", "q", "batch"].some((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select value={params.get("project") ?? "all"} onValueChange={(v) => set("project", v)}>
        <SelectTrigger className="w-48" aria-label="Filter by project">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          <SelectItem value="personal">Personal / unallocated</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showCategory && categories && (
        <Select value={params.get("category") ?? "all"} onValueChange={(v) => set("category", v)}>
          <SelectTrigger className="w-48" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        type="month"
        aria-label="Month"
        className="w-40"
        value={params.get("month") ?? defaultMonth ?? ""}
        onChange={(e) => set("month", e.target.value || null)}
      />
      {showSearch && (
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", q.trim() || null);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant or description" className="w-64 pl-8" />
        </form>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            router.push(pathname);
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
