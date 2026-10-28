"use client";

import { Check, Copy, Loader2, Mail, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { createInviteAction, revokeInviteAction } from "./actions";

type Invite = { id: string; email: string; role: string; expiresAt: string; createdAt: string; invitedBy: string | null };

export function InvitePanel({ invites, canInviteOwners }: { invites: Invite[]; canInviteOwners: boolean }) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>Invite links expire after 7 days and work once.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          ref={formRef}
          className="flex flex-wrap items-end gap-3"
          action={(form) =>
            startTransition(async () => {
              const r = await createInviteAction(form);
              if (!r.ok) return void toast.error(r.error);
              setCreated({ email: String(form.get("email")), ...r.data! });
              setCopied(false);
              formRef.current?.reset();
            })
          }
        >
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required className="w-64" placeholder="name@example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select name="role" defaultValue="member">
              <SelectTrigger id="invite-role" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canInviteOwners && <SelectItem value="owner">Owner</SelectItem>}
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Mail />}
            Create invite
          </Button>
        </form>

        {created && (
          <Alert data-testid="invite-link">
            <AlertTitle>Invite created for {created.email}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{created.emailed ? "We emailed them this link." : "Email isn't configured. Send them this link yourself:"}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs" data-testid="invite-url">
                  {created.url}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(created.url);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {invites.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Pending invites</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited by</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell className="capitalize">{i.role}</TableCell>
                    <TableCell className="text-muted-foreground">{i.invitedBy ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(i.expiresAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Revoke invite for ${i.email}`}
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const r = await revokeInviteAction(i.id);
                            if (r.ok) toast.success(r.message);
                            else toast.error(r.error);
                          })
                        }
                      >
                        <X />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
