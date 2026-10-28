"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function DisableTwoFactor() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const { error } = await authClient.twoFactor.disable({
          password: String(new FormData(e.currentTarget).get("password")),
        });
        setPending(false);
        if (error) return void toast.error(error.message ?? "Couldn't turn off 2FA.");
        toast.success("Two-factor authentication is off.");
        router.refresh();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="disable-password">Password</Label>
        <Input id="disable-password" name="password" type="password" required className="w-56" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Turn off 2FA
      </Button>
    </form>
  );
}
