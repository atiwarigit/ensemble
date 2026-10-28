import { AppSidebar, type NavIcon } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { getWorkspace } from "@/lib/services/workspace";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, ctx } = await requireAppContext();
  const workspace = await getWorkspace(db, ctx);

  const main: { title: string; href: string; icon: NavIcon }[] = [
    { title: "Dashboard", href: "/", icon: "LayoutDashboard" },
    { title: "Projects", href: "/projects", icon: "FolderKanban" },
    { title: "Expenses", href: "/expenses", icon: "Receipt" },
    { title: "Audit log", href: "/audit", icon: "ScrollText" },
  ];
  const settings: { title: string; href: string; icon: NavIcon }[] = [
    { title: "Members", href: "/settings/members", icon: "Users" },
    { title: "Security", href: "/settings/security", icon: "ShieldCheck" },
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
