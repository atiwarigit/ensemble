"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ACTION_GROUPS = [
  { value: "auth.", label: "Sign-ins & security" },
  { value: "workspace.", label: "Workspace & invites" },
  { value: "project.", label: "Projects" },
  { value: "lyric.", label: "Lyrics & authorship" },
  { value: "rights.", label: "Rights packages" },
  { value: "approval.", label: "Approvals" },
  { value: "expense", label: "Expenses" },
  { value: "import.", label: "CSV imports" },
];

export function AuditFilters({
  projects,
  projectId,
  action,
}: {
  projects: { id: string; name: string }[];
  projectId?: string;
  action?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function update(key: string, value: string) {
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (action) params.set("action", action);
    if (value === "all") params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <Select value={projectId ?? "all"} onValueChange={(v) => update("project", v)}>
        <SelectTrigger className="w-52" aria-label="Filter by project">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={action ?? "all"} onValueChange={(v) => update("action", v)}>
        <SelectTrigger className="w-52" aria-label="Filter by type">
          <SelectValue placeholder="All activity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All activity</SelectItem>
          {action && !ACTION_GROUPS.some((g) => g.value === action) && <SelectItem value={action}>{action}</SelectItem>}
          {ACTION_GROUPS.map((g) => (
            <SelectItem key={g.value} value={g.value}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
