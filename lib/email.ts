import "server-only";

/** Sends the invite via Resend when configured. Returns false when email isn't set up so the UI shows the link instead. */
export async function sendInviteEmail(opts: { to: string; url: string; inviterName: string; role: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: `${opts.inviterName} invited you to Ensemble`,
      text: `${opts.inviterName} invited you to join Ensemble as ${opts.role}.\n\nAccept the invite: ${opts.url}\n\nThis link expires in 7 days.`,
    }),
  });
  if (!res.ok) {
    console.error("Invite email failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

/** Operational alerts (e.g. an audit-chain break). Returns how many recipients were emailed. */
export async function sendAlertEmail(opts: { to: string[]; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = [...new Set(opts.to.filter(Boolean))];
  if (!key || !from || to.length === 0) return 0;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: opts.subject, text: opts.text }),
  });
  if (!res.ok) {
    console.error("Alert email failed", res.status, await res.text().catch(() => ""));
    return 0;
  }
  return to.length;
}
