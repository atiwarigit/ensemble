"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { errorMessage } from "@/lib/authz";
import { acceptInvite } from "@/lib/services/invites";

export type AcceptState = { error?: string } | undefined;

export async function acceptInviteAction(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const h = await headers();
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "Passwords don't match." };
  let email: string;
  try {
    ({ email } = await acceptInvite(
      { token: String(form.get("token") ?? ""), name: String(form.get("name") ?? ""), password },
      { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") },
    ));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  await auth.api.signInEmail({ body: { email, password }, headers: h });
  redirect("/");
}
