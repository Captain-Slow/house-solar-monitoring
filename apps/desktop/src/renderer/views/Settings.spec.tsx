import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settings } from "./Settings";

function settingsMarkup(role: "ADMIN" | "VIEWER" | "UNKNOWN"): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Settings role={role} onReset={() => {}} />
    </QueryClientProvider>,
  );
}

describe("Settings mutation visibility", () => {
  it("hides every mutating tariff, holiday, rate, reading and policy form for VIEWER", () => {
    const html = settingsMarkup("VIEWER");
    expect(html).toContain("VIEWER access");
    expect(html).toContain("Tariff holidays");
    expect(html).not.toContain("TNB RP4 ToU + NEM template");
    expect(html).not.toContain("Save meter reading");
    expect(html).not.toContain("Delete exclusion");
  });
  it("does not unlock mutations for UNKNOWN role", () => {
    const html = settingsMarkup("UNKNOWN");
    expect(html).toContain("Role could not be verified");
    expect(html).not.toContain("Create tariff");
  });
  it("shows the real tariff editor and configured mutations for ADMIN", () => {
    const html = settingsMarkup("ADMIN");
    expect(html).toContain("TNB RP4 ToU + NEM template");
    expect(html).toContain("Save meter reading");
    expect(html).toContain("Delete exclusion");
  });
});
