import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { listNotifications } from "@/lib/services/alerts";
import { MarkReadButton } from "./mark-read";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { ctx } = await requireAppContext();
  const rows = await listNotifications(db, ctx, { limit: 100 });
  const unread = rows.filter((r) => !r.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Streaming alerts for your projects, and system notices for owners and admins."
        actions={unread > 0 ? <MarkReadButton ids="all" /> : undefined}
      />
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Bell className="size-8" />
              <p>Nothing yet. Alerts appear here when streams change sharply, a follower milestone is passed, or an export is overdue.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map(({ n, projectName, readAt }) => (
                <li key={n.id} className="flex flex-wrap items-start gap-3 py-3" data-testid="notification" data-read={readAt ? "true" : "false"}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${readAt ? "bg-transparent" : "bg-primary"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.href ? (
                        <Link href={n.href} className="font-medium hover:underline">
                          {n.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{n.title}</span>
                      )}
                      {projectName ? <Badge variant="outline">{projectName}</Badge> : <Badge variant="secondary">Workspace</Badge>}
                      {!readAt && <span className="sr-only">Unread</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                  </div>
                  {!readAt && <MarkReadButton ids={[n.id]} label="Mark read" />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
