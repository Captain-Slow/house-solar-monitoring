import { describe, expect, it } from "vitest";
import { TNB_TEMPLATE, validateTariffJson } from "./tariff";

describe("tariff JSON editor", () => {
  it("inserts backend TNB RP4 ToU + NEM structure without inventing rates", () => {
    const template = JSON.stringify(TNB_TEMPLATE);
    expect(template).toContain('"touOffset":"PRO_RATA"');
    expect(template).toContain('"rate":""');
    expect(validateTariffJson(template).valid).toBe(false);
  });
  it("rejects malformed JSON and missing bill-derived prices", () => {
    expect(validateTariffJson("{").valid).toBe(false);
    const invalid = validateTariffJson(JSON.stringify(TNB_TEMPLATE));
    expect(invalid.valid).toBe(false);
    if (!invalid.valid)
      expect(invalid.errors.join(" ")).toMatch(/decimal|regex/i);
  });
  it("accepts completed decimal rates but rejects descending precision-sensitive tiers", () => {
    const rules = structuredClone(TNB_TEMPLATE);
    for (const component of rules.components) {
      if ("rates" in component)
        for (const entry of component.rates ?? [])
          for (const tier of entry.tiers) {
            tier.rate = "0.000001";
            if (tier.uptoKwh === "") tier.uptoKwh = "1000";
          }
      if ("amount" in component) {
        component.amount = "0.000001";
        component.waiveIfConsumptionAtOrBelowKwh = "600";
      }
      if ("percent" in component) component.percent = "0.000001";
    }
    const result = validateTariffJson(JSON.stringify(rules));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.rules).toContain("0.000001");
    const first = rules.components[0];
    if (!first || !("rates" in first) || !first.rates)
      throw new Error("Missing energy tiers");
    first.rates[0]!.tiers.splice(1, 0, {
      uptoKwh: "999.999999",
      rate: "0.000001",
    });
    const decreasing = validateTariffJson(JSON.stringify(rules));
    expect(decreasing.valid).toBe(false);
    if (!decreasing.valid)
      expect(decreasing.errors.join(" ")).toContain(
        "Tier boundaries must increase",
      );
  });
});
