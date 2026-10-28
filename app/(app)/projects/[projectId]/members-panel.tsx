"use client";

import { Loader2, UserPlus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { removeProjectMemberAction, setProjectMemberAction } from "../actions";

type Member = { userId: string; name: string; email: string; role: string; addedAt: string };
type Addable = { userId: string; name: string; email: string; workspaceRole: string };

const ROLES = [
  { value: "lead", label: "Lead" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

export function MembersPanel({
  projectId,
  members,
  addable,
  canManage,
  currentUserId,
}: {
  projectId: string;
  members: Member[];
  addable: Addable[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [newUser, setNewUser] = useState<string>("");
  const [newRole, setNewRole] = useState("editor");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="w-36">Role</TableHead>
            {canManage && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.userId} data-testid="project-member">
              <TableCell className="font-medium">
                {m.name}
                {m.userId === currentUserId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{m.email}</TableCell>
              <TableCell>
                {canManage ? (
                  <Select
                    value={m.role}
                    disabled={pending}
                    onValueChange={(role) => run(() => setProjectMemberAction(projectId, m.userId, role))}
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${m.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="capitalize">{m.role}</span>
                )}
              </TableCell>
              {canManage && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${m.name}`}
                    disabled={pending}
                    onClick={() => run(() => removeProjectMemberAction(projectId, m.userId))}
                  >
                    <X />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <Select value={newUser} onValueChange={setNewUser} disabled={!addable.length}>
            <SelectTrigger className="w-60" aria-label="Person to add">
              <SelectValue placeholder={addable.length ? "Add a workspace member…" : "Everyone is already on this project"} />
            </SelectTrigger>
            <SelectContent>
              {addable.map((a) => (
                <SelectItem key={a.userId} value={a.userId}>
                  {a.name} ({a.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger className="w-28" aria-label="Role for new member">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!newUser || pending}
            onClick={() =>
              run(async () => {
                const r = await setProjectMemberAction(projectId, newUser, newRole);
                if (r.ok) setNewUser("");
                return { ...r, message: r.ok ? "Member added." : undefined };
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
