import { z } from "zod";

// Mirrors the backend's candidate tnbTemplateRules; intentionally invalid until bill-derived blanks are filled.
export const TNB_TEMPLATE = {
  currency: "MYR",
  timezone: "Asia/Kuala_Lumpur",
  touWindows: [
    {
      code: "PEAK",
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "14:00",
      end: "22:00",
      excludeHolidays: true,
    },
  ],
  defaultWindow: "OFFPEAK",
  consumptionBasis: "GROSS_IMPORT",
  thresholdProration: "NONE",
  nem: {
    offsetComponents: ["ENERGY"],
    touOffset: "PRO_RATA",
    creditExpiryPeriods: 12,
  },
  components: [
    {
      code: "ENERGY",
      label: "ToU energy (unverified)",
      kind: "PER_KWH",
      basis: "IMPORT",
      tierMode: "INCREMENTAL",
      rates: [
        {
          window: "PEAK",
          tiers: [
            { uptoKwh: "", rate: "" },
            { uptoKwh: null, rate: "" },
          ],
        },
        {
          window: "OFFPEAK",
          tiers: [
            { uptoKwh: "", rate: "" },
            { uptoKwh: null, rate: "" },
          ],
        },
      ],
    },
    {
      code: "CAPACITY",
      label: "Capacity (unverified)",
      kind: "PER_KWH",
      basis: "IMPORT",
      tierMode: "INCREMENTAL",
      rates: [{ window: "ANY", tiers: [{ uptoKwh: null, rate: "" }] }],
    },
    {
      code: "NETWORK",
      label: "Network (unverified)",
      kind: "PER_KWH",
      basis: "IMPORT",
      tierMode: "INCREMENTAL",
      rates: [{ window: "ANY", tiers: [{ uptoKwh: null, rate: "" }] }],
    },
    {
      code: "RETAIL",
      label: "Retail (unverified)",
      kind: "FIXED",
      amount: "",
      prorate: true,
      waiveIfConsumptionAtOrBelowKwh: "",
    },
    {
      code: "AFA",
      label: "Monthly AFA (unverified)",
      kind: "PER_KWH_MONTHLY",
      basis: "IMPORT",
    },
    {
      code: "EEI",
      label: "EEI rebate (unverified)",
      kind: "PERCENT",
      percent: "",
      ofComponents: ["ENERGY"],
      portion: "ALL",
    },
    {
      code: "KWTBB",
      label: "KWTBB (unverified)",
      kind: "PERCENT",
      percent: "",
      ofComponents: ["ENERGY"],
      portion: "ALL",
    },
    {
      code: "SST",
      label: "SST (unverified)",
      kind: "PERCENT",
      percent: "",
      ofComponents: ["ENERGY"],
      portion: "ALL",
    },
  ],
  totalRounding: "NONE",
};

const decimal = z
  .string()
  .regex(
    /^-?\d{1,6}(\.\d{1,6})?$/,
    "Enter a decimal from the bill (up to six fractional digits)",
  );
const nonNegative = decimal.refine(
  (value) => !value.startsWith("-"),
  "Must be non-negative",
);
const code = z.string().min(1);
const component = z.discriminatedUnion("kind", [
  z.strictObject({
    code,
    label: code,
    kind: z.literal("PER_KWH"),
    basis: z.literal("IMPORT"),
    tierMode: z.enum(["INCREMENTAL", "WHOLE"]),
    rates: z
      .array(
        z.strictObject({
          window: code,
          tiers: z
            .array(
              z.strictObject({
                uptoKwh: nonNegative.nullable(),
                rate: decimal,
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    code,
    label: code,
    kind: z.literal("PER_KWH_MONTHLY"),
    basis: z.literal("IMPORT"),
    applyIfConsumptionAboveKwh: nonNegative.optional(),
  }),
  z.strictObject({
    code,
    label: code,
    kind: z.literal("FIXED"),
    amount: decimal,
    prorate: z.boolean(),
    waiveIfConsumptionAtOrBelowKwh: nonNegative.optional(),
  }),
  z.strictObject({
    code,
    label: code,
    kind: z.literal("PERCENT"),
    percent: decimal,
    ofComponents: z.array(code).min(1),
    applyIfConsumptionAboveKwh: nonNegative.optional(),
    portion: z.enum(["ALL", "ABOVE_THRESHOLD_SHARE"]),
  }),
]);
function compareNonNegativeDecimals(left: string, right: string): number {
  const [leftInteger = "", leftFraction = ""] = left.split(".");
  const [rightInteger = "", rightFraction = ""] = right.split(".");
  const wholeLeft = leftInteger.replace(/^0+(?=\d)/, "");
  const wholeRight = rightInteger.replace(/^0+(?=\d)/, "");
  if (wholeLeft.length !== wholeRight.length)
    return wholeLeft.length < wholeRight.length ? -1 : 1;
  if (wholeLeft !== wholeRight) return wholeLeft < wholeRight ? -1 : 1;
  const fractionLeft = leftFraction.padEnd(6, "0");
  const fractionRight = rightFraction.padEnd(6, "0");
  return fractionLeft === fractionRight
    ? 0
    : fractionLeft < fractionRight
      ? -1
      : 1;
}

const schema = z
  .strictObject({
    currency: z.literal("MYR"),
    timezone: code,
    touWindows: z.array(
      z.strictObject({
        code,
        days: z
          .array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]))
          .min(1),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        excludeHolidays: z.boolean(),
      }),
    ),
    defaultWindow: code,
    consumptionBasis: z.enum(["GROSS_IMPORT", "NET_IMPORT"]),
    thresholdProration: z.enum(["NONE", "DAYS_OVER_30"]),
    nem: z
      .strictObject({
        offsetComponents: z.array(code).min(1),
        touOffset: z.enum(["PRO_RATA", "SAME_WINDOW_FIRST"]),
        creditExpiryPeriods: z.number().int().positive(),
      })
      .nullable(),
    components: z.array(component).min(1),
    totalRounding: z.enum(["NONE", "NEAREST_0_05"]),
  })
  .superRefine((rules, ctx) => {
    const windows = new Set([rules.defaultWindow, "ANY"]);
    const usedWindows = new Set<string>();
    for (const [i, window] of rules.touWindows.entries()) {
      if (
        window.start >= window.end ||
        Number(window.start.slice(3)) % 5 ||
        Number(window.end.slice(3)) % 5
      )
        ctx.addIssue({
          code: "custom",
          path: ["touWindows", i],
          message: "Window must align to five minutes and end after its start",
        });
      if (
        windows.has(window.code) ||
        usedWindows.has(window.code) ||
        new Set(window.days).size !== window.days.length
      )
        ctx.addIssue({
          code: "custom",
          path: ["touWindows", i],
          message: "Window codes and weekdays must be unique",
        });
      windows.add(window.code);
      usedWindows.add(window.code);
    }
    const used = new Set<string>();
    for (const [i, item] of rules.components.entries()) {
      if (used.has(item.code))
        ctx.addIssue({
          code: "custom",
          path: ["components", i, "code"],
          message: "Duplicate component code",
        });
      if (item.kind === "PER_KWH") {
        const rateWindows = new Set<string>();
        for (const [j, rate] of item.rates.entries()) {
          if (!windows.has(rate.window) || rateWindows.has(rate.window))
            ctx.addIssue({
              code: "custom",
              path: ["components", i, "rates", j, "window"],
              message: "Unknown or repeated window",
            });
          rateWindows.add(rate.window);
          if (rate.tiers.at(-1)?.uptoKwh !== null)
            ctx.addIssue({
              code: "custom",
              path: ["components", i, "rates", j],
              message: "Last tier must be open-ended",
            });
          for (const [k, tier] of rate.tiers.entries()) {
            if (tier.uptoKwh === null && k !== rate.tiers.length - 1)
              ctx.addIssue({
                code: "custom",
                path: ["components", i, "rates", j, "tiers", k],
                message: "Open-ended tier must be last",
              });
            if (
              k > 0 &&
              tier.uptoKwh != null &&
              rate.tiers[k - 1]?.uptoKwh != null &&
              compareNonNegativeDecimals(
                tier.uptoKwh,
                rate.tiers[k - 1]!.uptoKwh!,
              ) <= 0
            )
              ctx.addIssue({
                code: "custom",
                path: ["components", i, "rates", j, "tiers", k],
                message: "Tier boundaries must increase",
              });
          }
        }
        if (!rateWindows.has("ANY"))
          for (const window of windows)
            if (window !== "ANY" && !rateWindows.has(window))
              ctx.addIssue({
                code: "custom",
                path: ["components", i, "rates"],
                message: `Missing rate for ${window}`,
              });
      }
      if (item.kind === "PERCENT") {
        for (const ref of item.ofComponents)
          if (!used.has(ref))
            ctx.addIssue({
              code: "custom",
              path: ["components", i, "ofComponents"],
              message: `Unknown preceding component ${ref}`,
            });
        if (
          item.portion === "ABOVE_THRESHOLD_SHARE" &&
          item.applyIfConsumptionAboveKwh === undefined
        )
          ctx.addIssue({
            code: "custom",
            path: ["components", i],
            message: "Above-threshold share requires a threshold",
          });
      }
      used.add(item.code);
    }
    for (const ref of rules.nem?.offsetComponents ?? [])
      if (
        !rules.components.some(
          (item) =>
            item.code === ref &&
            (item.kind === "PER_KWH" || item.kind === "PER_KWH_MONTHLY"),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["nem", "offsetComponents"],
          message: `Invalid offset component ${ref}`,
        });
  });

export function validateTariffJson(
  json: string,
): { valid: true; rules: string } | { valid: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { valid: false, errors: ["Invalid JSON syntax"] };
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    return {
      valid: false,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  try {
    new Intl.DateTimeFormat("en", { timeZone: result.data.timezone });
  } catch {
    return { valid: false, errors: ["timezone: Invalid IANA time zone"] };
  }
  return { valid: true, rules: json };
}
