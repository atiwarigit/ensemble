import { PageHeader } from "@/components/page-header";
import { requireAppContext } from "@/lib/authz";
import { ExpenseTabs } from "./tabs";

export default async function ExpensesLayout({ children }: LayoutProps<"/expenses">) {
  await requireAppContext();
  return (
    <>
      <PageHeader title="Expenses" description="Track spending by project, import bank exports, and watch budgets." />
      <ExpenseTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
