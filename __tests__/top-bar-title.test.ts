import { describe, it, expect } from "vitest";
import { titleFor } from "@/components/top-bar";
describe("titleFor", () => {
  it.each([
    ["/campaigns", "Campaigns"], ["/campaigns/abc", "Campaign"], ["/campaigns/abc/edit", "Edit Campaign"],
    ["/campaigns/new", "New Campaign"], ["/campaigns/import", "Import Campaigns"], ["/logs", "DM Logs"], ["/leads", "Leads"],
    ["/overview", "Overview"], ["/trend", "Trend"], ["/inbox", "Inbox"], ["/diagnostics", "Diagnostics"], ["/settings", "Settings"], ["/x", "Dashboard"],
  ])("%s -> %s", (p, t) => expect(titleFor(p)).toBe(t));
});
