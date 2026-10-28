import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/authz";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const params = await props.searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") ? params.next : "/";
  const session = await getSession();
  if (session && params.error !== "no-workspace") redirect(next);

  return (
    <AuthShell>
      <SignInForm next={next} noWorkspace={params.error === "no-workspace"} />
    </AuthShell>
  );
}
