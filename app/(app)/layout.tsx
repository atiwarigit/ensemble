import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { countAwaitingMe } from "@/lib/services/approvals";
import { getWorkspace } from "@/lib/services/workspace";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, ctx } = await requireAppContext();
  const [workspace, awaiting] = await Promise.all([getWorkspace(db, ctx), countAwaitingMe(db, ctx)]);

  const main: NavItem[] = [
    { title: "Dashboard", href: "/", icon: "LayoutDashboard" },
    { title: "Chat", href: "/chat", icon: "MessageSquare" },
    { title: "Projects", href: "/projects", icon: "FolderKanban" },
    { title: "Lyrics", href: "/lyrics", icon: "FileText" },
    { title: "Expenses", href: "/expenses", icon: "Receipt" },
    { title: "Approvals", href: "/approvals", icon: "Inbox", badge: awaiting },
    { title: "Audit log", href: "/audit", icon: "ScrollText" },
  ];
  const settings: NavItem[] = [
    { title: "Members", href: "/settings/members", icon: "Users" },
    { title: "Security", href: "/settings/security", icon: "ShieldCheck" },
    { title: "AI assistant", href: "/settings/ai", icon: "Bot" },
  ];

  return (
    <SidebarProvider>
      <AppSidebar
        workspaceName={workspace?.name ?? "Workspace"}
        user={{ name: user.name, email: user.email }}
        role={ctx.workspaceRole}
        main={main}
        settings={settings}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-semibold">Ensemble</span>
        </header>
        <div className="flex-1 p-4 md:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
