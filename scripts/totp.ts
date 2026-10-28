// Dev helper: prints the current TOTP code for a base32 secret or an otpauth:// URI.
// Usage: pnpm totp "otpauth://totp/Ensemble:romel@...?secret=ABC..."   or   pnpm totp ABCDEF...
import { totp } from "@/lib/totp";

const arg = process.argv[2];
if (arg) {
  const secret = arg.startsWith("otpauth://") ? new URL(arg).searchParams.get("secret")! : arg;
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${totp(secret)}  (valid ~${remaining}s)`);
}
