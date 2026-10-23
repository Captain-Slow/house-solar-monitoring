import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingPeriodQuery } from "@solar/contracts/generated/graphql";
import { solarQueryKey } from "../api";
import { BillingLineItems, UsageCost } from "./UsageCost";

describe("Usage & Cost numeric reasons", () => {
  it("renders an unavailable total with its billing reason tooltip and preserves zero coverage", () => {
    const client = new QueryClient();
    client.setQueryData(
      solarQueryKey("BillingPeriods", { first: 24, after: null }),
      {
        billingPeriods: {
          edges: [
            {
              node: {
                id: 1,
                startDate: "2026-09-01",
                endDate: "2026-10-01",
                tariffId: 1,
                stale: false,
                result: {
                  status: "UNAVAILABLE",
                  total: null,
                  coverage: "0",
                  reasons: ["MISSING_GRID_DATA"],
                  isLowerBound: false,
                  nem: null,
                },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UsageCost siteTimezone="Asia/Kuala_Lumpur" />
      </QueryClientProvider>,
    );
    expect(html).toContain('title="MISSING_GRID_DATA"');
    expect(html).toContain('title="0"');
    expect(html).toContain("coverage 0 %");
  });
  it("explains missing monthly AFA rates instead of using the billing month as the reason", () => {
    const result = {
      reasons: ["MONTHLY_RATE_MISSING:AFA"],
      coverage: "1",
      isLowerBound: false,
      status: "ESTIMATED",
      subtotal: null,
      total: null,
      nem: null,
      lineItems: [
        {
          code: "AFA",
          label: "Monthly AFA",
          kind: "PER_KWH_MONTHLY",
          segment: 0,
          quantityKwh: "42",
          rate: null,
          amount: null,
          status: "UNAVAILABLE",
          note: "2026-10",
        },
      ],
    } as NonNullable<
      NonNullable<BillingPeriodQuery["billingPeriod"]>["result"]
    >;
    const html = renderToStaticMarkup(<BillingLineItems result={result} />);
    expect(html).toContain(
      'title="MONTHLY_RATE_MISSING:AFA · billing month 2026-10"',
    );
    expect(html).not.toContain('title="2026-10">—');
  });
  it("marks fixed-charge quantity null as not applicable rather than OK", () => {
    const result = {
      reasons: [],
      coverage: "1",
      isLowerBound: false,
      status: "COMPLETE",
      subtotal: "10",
      total: "10",
      nem: null,
      lineItems: [
        {
          code: "RETAIL",
          label: "Retail charge",
          kind: "FIXED",
          segment: 0,
          quantityKwh: null,
          rate: "10",
          amount: "10",
          status: "OK",
          note: null,
        },
      ],
    } as NonNullable<
      NonNullable<BillingPeriodQuery["billingPeriod"]>["result"]
    >;
    const html = renderToStaticMarkup(<BillingLineItems result={result} />);
    expect(html).toContain('title="Not applicable">—</td>');
    expect(html).not.toContain('title="OK">—</td>');
  });
});
