"use client";

import { ShieldCheck, ShieldOff, X } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { changeRoleAction, removeMemberAction } from "./actions";

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  twoFactorEnabled: boolean;
  joinedAt: string;
};

export function MembersTable({
  members,
  currentUserId,
  canChangeRoles,
  canRemove,
}: {
  members: Member[];
  currentUserId: string;
  canChangeRoles: boolean;
  canRemove: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>2FA</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="w-36">Role</TableHead>
          {canRemove && <TableHead className="w-10" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.userId} data-testid="workspace-member">
            <TableCell className="font-medium">
              {m.name}
              {m.userId === currentUserId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
            </TableCell>
            <TableCell className="text-muted-foreground">{m.email}</TableCell>
            <TableCell>
              {m.twoFactorEnabled ? (
                <Badge variant="secondary">
                  <ShieldCheck /> On
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <ShieldOff /> Off
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(m.joinedAt)}</TableCell>
            <TableCell>
              {canChangeRoles && m.userId !== currentUserId ? (
                <Select value={m.role} disabled={pending} onValueChange={(role) => run(() => changeRoleAction(m.userId, role))}>
                  <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${m.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="capitalize">{m.role}</span>
              )}
            </TableCell>
            {canRemove && (
              <TableCell>
                {m.userId !== currentUserId && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${m.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Remove ${m.name} from the workspace? They lose access to every project.`)) {
                        run(() => removeMemberAction(m.userId));
                      }
                    }}
                  >
                    <X />
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
