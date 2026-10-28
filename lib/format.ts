const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const dateOnly = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function formatDateTime(d: Date | string) {
  return `${dateTime.format(new Date(d))} UTC`;
}

export function formatDate(d: Date | string) {
  return dateOnly.format(new Date(d));
}

export function humanizeAction(action: string) {
  return action.replaceAll(".", " · ").replaceAll("_", " ");
}
