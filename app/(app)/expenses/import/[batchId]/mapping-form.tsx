"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MappingConfig } from "@/lib/csv/expenses-csv";
import { updateMappingAction } from "../../actions";

const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "M/D/YY", "DD.MM.YYYY"];

function ColumnSelect({
  name,
  label,
  headers,
  value,
  optional,
}: {
  name: string;
  label: string;
  headers: string[];
  value: string | null | undefined;
  optional?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`map-${name}`}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      <Select name={name} defaultValue={value ?? "__none"}>
        <SelectTrigger id={`map-${name}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{optional ? "— Not in file —" : "— Choose a column —"}</SelectItem>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function MappingForm({ batchId, headers, mapping }: { batchId: string; headers: string[]; mapping: MappingConfig }) {
  const [pending, startTransition] = useTransition();
  const [amountMode, setAmountMode] = useState(mapping.amountMode);
  const m = mapping.columnMap;

  return (
    <form
      key={JSON.stringify(mapping)}
      className="grid gap-5"
      action={(form) =>
        startTransition(async () => {
          const r = await updateMappingAction(batchId, form);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ColumnSelect name="date" label="Date" headers={headers} value={m.date} />
        <div className="grid gap-2">
          <Label htmlFor="map-dateFormat">Date format</Label>
          <Select name="dateFormat" defaultValue={mapping.dateFormat}>
            <SelectTrigger id="map-dateFormat" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ColumnSelect name="description" label="Description" headers={headers} value={m.description} />
        <ColumnSelect name="merchant" label="Merchant" headers={headers} value={m.merchant} optional />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor="map-amountMode">Amounts</Label>
          <Select name="amountMode" value={amountMode} onValueChange={(v) => setAmountMode(v as typeof amountMode)}>
            <SelectTrigger id="map-amountMode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="negative_is_expense">One column, negative = spending</SelectItem>
              <SelectItem value="positive_is_expense">One column, positive = spending</SelectItem>
              <SelectItem value="split">Separate debit / credit columns</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {amountMode === "split" ? (
          <>
            <ColumnSelect name="debit" label="Debit (money out)" headers={headers} value={m.debit} />
            <ColumnSelect name="credit" label="Credit (money in)" headers={headers} value={m.credit} optional />
          </>
        ) : (
          <ColumnSelect name="amount" label="Amount" headers={headers} value={m.amount} />
        )}
        <ColumnSelect name="account" label="Account / card" headers={headers} value={m.account} optional />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ColumnSelect name="category" label="Category" headers={headers} value={m.category} optional />
        <ColumnSelect name="currency" label="Currency" headers={headers} value={m.currency} optional />
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="map-saveAs">
            Save as preset <span className="font-normal text-muted-foreground">(optional, e.g. &quot;Chase checking&quot;)</span>
          </Label>
          <Input id="map-saveAs" name="saveAs" maxLength={60} placeholder="Applied automatically to files with the same headers" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Account and card numbers are stored as the last 4 digits only.</p>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Update preview
        </Button>
      </div>
    </form>
  );
}
