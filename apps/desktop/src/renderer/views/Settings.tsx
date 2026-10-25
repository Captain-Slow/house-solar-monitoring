import {
  Children,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { PanelShell } from "../components/panel-shell";
import { useQueryClient } from "@tanstack/react-query";
import type { OperationName } from "@solar/contracts/bridge";
import type {
  AccountingPoliciesQuery,
  BillingPeriodsQuery,
  DataExclusionsQuery,
  TariffHolidaysQuery,
  TariffMonthlyRatesQuery,
  TariffsQuery,
} from "@solar/contracts/generated/graphql";
import { solarQuery, useMeterReadings, useSolarQuery } from "../api";
import { MeterReadingsPager, Message } from "../components/Display";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable, Td, Th, Tr } from "../components/ui/data-table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { EmptyList } from "../components/ui/empty";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Reason } from "../components/ui/reason";
import { Separator } from "../components/ui/separator";
import { statusTone } from "../components/ui/status-tone";
import { cn } from "../lib/utils";
import { decimal, localInstant, isAdmin, numericReason } from "../models";
import { TNB_TEMPLATE, validateTariffJson } from "../tariff";
import accountingIcon from "../assets/settings-icons/accounting.png";
import billingIcon from "../assets/settings-icons/billing.png";
import connectionIcon from "../assets/settings-icons/connection.png";
import exclusionsIcon from "../assets/settings-icons/exclusions.png";
import meterReadingsIcon from "../assets/settings-icons/meter-readings.png";
import tariffsIcon from "../assets/settings-icons/tariffs.png";

type SettingsSnapshot = {
  backendUrl: string | null;
  pinnedFingerprint: string | null;
  hasToken: boolean;
};

const tiles = [
  {
    id: "connection",
    title: "Connection",
    description: "Backend URL, pinned fingerprint",
    icon: connectionIcon,
  },
  {
    id: "tariffs",
    title: "Tariffs",
    description: "Tariffs, holidays and monthly rates",
    icon: tariffsIcon,
  },
  {
    id: "billing",
    title: "Billing",
    description: "Billing periods",
    icon: billingIcon,
  },
  {
    id: "accounting",
    title: "Accounting",
    description: "Accounting policy",
    icon: accountingIcon,
  },
  {
    id: "exclusions",
    title: "Exclusions",
    description: "Data exclusions",
    icon: exclusionsIcon,
  },
  {
    id: "meter-readings",
    title: "Meter readings",
    description: "Utility readings",
    icon: meterReadingsIcon,
  },
] as const;

type TileId = (typeof tiles)[number]["id"];

/** The grid's last row has no bottom hairline (Motrix settings-page.tsx). */
const COLUMNS_PER_ROW = 3;
const lastRowStart =
  Math.floor((tiles.length - 1) / COLUMNS_PER_ROW) * COLUMNS_PER_ROW;

type Action = {
  tile: TileId;
  label: string;
  operation: OperationName;
  initial: string;
  variable: string;
  hint: string;
};
const actions: Action[] = [
  {
    tile: "tariffs",
    label: "Holidays",
    operation: "SetTariffHolidays",
    variable: "holidays",
    hint: 'Enter the tariff ID and year in JSON, with holidays as [{"date":"YYYY-MM-DD","name":"…"}]. This replaces that year’s holiday list.',
    initial: '{\n  "tariffId": null,\n  "year": null,\n  "holidays": []\n}',
  },
  {
    tile: "billing",
    label: "Billing period",
    operation: "UpsertBillingPeriod",
    variable: "input",
    hint: "Local dates mark the start (inclusive) and end (exclusive). Optional bill must be a JSON string accepted by the backend; do not paste an unredacted bill.",
    initial:
      '{\n  "tariffId": null,\n  "startDate": "",\n  "endDate": "",\n  "note": ""\n}',
  },
  {
    tile: "meter-readings",
    label: "Meter reading",
    operation: "AddMeterReading",
    variable: "input",
    hint: "Decimal kWh values must be quoted strings; enter your actual measured utility reading.",
    initial:
      '{\n  "readAt": "",\n  "importKwh": "",\n  "source": "UTILITY_METER_MANUAL",\n  "note": ""\n}',
  },
  {
    tile: "accounting",
    label: "Accounting policy",
    operation: "CreateAccountingPolicy",
    variable: "input",
    hint: "Set sources supported by the backend and effective instant; policy changes recalculate historical data.",
    initial:
      '{\n  "effectiveFrom": "",\n  "gridSource": "",\n  "pvSource": "",\n  "loadSource": "",\n  "batterySource": "",\n  "maxGapSec": 0,\n  "note": ""\n}',
  },
  {
    tile: "exclusions",
    label: "Data exclusion",
    operation: "CreateDataExclusion",
    variable: "input",
    hint: "Enter actual UTC instants and family names for data to exclude.",
    initial:
      '{\n  "from": "",\n  "to": "",\n  "families": [],\n  "reason": ""\n}',
  },
];

const groupClass = "flex min-w-0 flex-col items-start gap-3";
const headingClass = "text-sm font-semibold";
const subheadingClass = "text-sm font-medium";
const helperClass = "text-xs text-muted-foreground";
const fieldClass = "flex min-w-0 flex-col gap-1.5 text-sm font-medium";
/** Settings row (ref-03): label on the left, 32px control on the right. */
const rowFieldClass =
  "flex min-w-0 items-start justify-between gap-4 text-sm font-medium [&>div]:w-56 [&>input]:w-56 [&>select]:w-56";
const listClass = "w-full divide-y divide-border rounded-lg border";
const rowClass = "px-3 py-2 text-xs";
/** A textarea drawn like `Input`, in the same typeface and tabular figures as the JSON it holds. */
const textareaClass =
  "w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-sans text-xs font-normal tabular-nums shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

/** A labelled control. The label keeps its text and wraps the control, so it names it. */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn(rowFieldClass, className)}>
      <span className="pt-1.5">{label}</span> {children}
    </label>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-3">{children}</div>;
}

/** Groups of a dialog, divided by hairlines. Falsy children (role-gated groups) leave no divider. */
function Sections({ children }: { children: ReactNode }) {
  return Children.toArray(children).flatMap((section, index) =>
    index === 0
      ? [section]
      : [<Separator key={`divider-${index}`} className="my-4" />, section],
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-sm font-medium">{label}</dt>
      <dd className="min-w-0 text-end text-sm break-all text-muted-foreground">
        {children}
      </dd>
    </div>
  );
}

/** Runs `render` only while mounted, so a closed dialog computes none of its content. */
function Lazy({ render }: { render: () => ReactNode }) {
  return render();
}

/** One settings dialog, adapted from Motrix general-dialog.tsx: header, scroll body, footer. */
function SettingsDialog({
  open,
  onClose,
  title,
  description,
  message,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  message: string;
  children: () => ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[700px]">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          {message && (
            <div className="mb-4">
              <Message>{message}</Message>
            </div>
          )}
          <Lazy render={children} />
        </div>
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Draft = { text: string; message: string };

/** Editor drafts live in Settings, so closing a dialog never discards what was typed. */
function MutationEditor({
  action,
  draft,
  onDraft,
}: {
  action: Action;
  draft: Draft | undefined;
  onDraft: (patch: Partial<Draft>) => void;
}) {
  const text = draft?.text ?? action.initial;
  const message = draft?.message ?? "";
  const setText = (value: string) => onDraft({ text: value });
  const setMessage = (value: string) => onDraft({ message: value });
  const client = useQueryClient();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Expected a JSON object");
      payload = parsed as Record<string, unknown>;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }
    try {
      const vars = action.variable === "input" ? { input: payload } : payload;
      await solarQuery(action.operation, vars);
      setMessage(`${action.label} saved.`);
      await client.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    }
  }
  return (
    <form className={groupClass} onSubmit={submit}>
      <h3 className={headingClass}>{action.label}</h3>
      <p className={helperClass}>{action.hint}</p>
      <label className={cn(fieldClass, "w-full")}>
        {action.label} JSON
        <textarea
          className={textareaClass}
          value={text}
          rows={Math.max(5, text.split("\n").length + 1)}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </label>
      <Button type="submit" size="sm">
        Save {action.label.toLowerCase()}
      </Button>
      {message && <Message>{message}</Message>}
    </form>
  );
}

export function Settings({
  role,
  onReset,
}: {
  role: "ADMIN" | "VIEWER" | "UNKNOWN" | undefined;
  onReset: () => void;
}) {
  const [config, setConfig] = useState<SettingsSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<TileId | null>(null);
  const [tariffId, setTariffId] = useState("");
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [tariffName, setTariffName] = useState("");
  const [tariffCurrency, setTariffCurrency] = useState("MYR");
  const [tariffZone, setTariffZone] = useState("Asia/Kuala_Lumpur");
  const [rules, setRules] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [rateMonth, setRateMonth] = useState("");
  const [rateComponent, setRateComponent] = useState("AFA");
  const [rate, setRate] = useState("");
  const [rateNote, setRateNote] = useState("");
  const [deleteReading, setDeleteReading] = useState("");
  const [deleteExclusion, setDeleteExclusion] = useState("");
  const client = useQueryClient();
  const tariffs = useSolarQuery<TariffsQuery>("Tariffs");
  const readings = useMeterReadings();
  const periods = useSolarQuery<BillingPeriodsQuery>("BillingPeriods", {
    first: 24,
    after: null,
  });
  const policies = useSolarQuery<AccountingPoliciesQuery>("AccountingPolicies");
  const exclusions = useSolarQuery<DataExclusionsQuery>("DataExclusions", {
    first: 100,
  });
  const selectedTariff = Number(tariffId);
  const validTariff =
    Number.isSafeInteger(selectedTariff) && selectedTariff > 0;
  const holidays = useSolarQuery<TariffHolidaysQuery>(
    "TariffHolidays",
    { tariffId: selectedTariff, year: holidayYear },
    undefined,
    validTariff,
  );
  const monthlyRates = useSolarQuery<TariffMonthlyRatesQuery>(
    "TariffMonthlyRates",
    { tariffId: selectedTariff },
    undefined,
    validTariff,
  );
  useEffect(() => {
    void window.solar.settings
      .get()
      .then(setConfig)
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error ? error.message : "Settings unavailable",
        ),
      );
  }, []);
  async function mutate(name: OperationName, vars: Record<string, unknown>) {
    try {
      await solarQuery(name, vars);
      setMessage(`${name} saved.`);
      await client.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    }
  }
  const admin = isAdmin(role);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const editors = (tile: TileId) =>
    actions
      .filter((action) => action.tile === tile)
      .map((action) => (
        <MutationEditor
          key={action.operation}
          action={action}
          draft={drafts[action.operation]}
          onDraft={(patch) =>
            setDrafts((current) => ({
              ...current,
              [action.operation]: {
                text: current[action.operation]?.text ?? action.initial,
                message: current[action.operation]?.message ?? "",
                ...patch,
              },
            }))
          }
        />
      ));
  const roleNotice = admin
    ? null
    : role === "VIEWER"
      ? "VIEWER access: tariff, readings, and policy changes are hidden."
      : "Role could not be verified; changes are hidden until ADMIN access is confirmed.";

  const connectionBody = () => (
    <div className={groupClass}>
      <h3 className={headingClass}>Connection</h3>
      <dl className="flex w-full flex-col gap-3">
        <Fact label="Backend URL">{config?.backendUrl ?? "—"}</Fact>
        <Fact label="Pinned TLS fingerprint">
          <span className="font-sans text-xs tabular-nums">
            {config?.pinnedFingerprint ?? "—"}
          </span>
        </Fact>
        <Fact label="Token stored securely">
          {config?.hasToken ? "Yes" : "No"}
        </Fact>
        <Fact label="Role">{role ?? "UNKNOWN"}</Fact>
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void window.solar.settings
            .clear()
            .then(onReset)
            .catch((error: unknown) =>
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Unable to clear settings",
              ),
            );
        }}
      >
        Forget connection and token
      </Button>
    </div>
  );

  const tariffsBody = () => (
    <Sections>
      <div className={groupClass}>
        <h3 className={headingClass}>Configured tariffs</h3>
        {tariffs.data ? (
          tariffs.data.tariffs.length === 0 ? (
            <EmptyList className="w-full">No tariffs configured.</EmptyList>
          ) : (
            <ul className={listClass}>
              {tariffs.data.tariffs.map((tariff) => (
                <li key={tariff.id} className={rowClass}>
                  #{tariff.id} · {tariff.name} · {tariff.currency} ·{" "}
                  {tariff.timezone}
                  <ul className="mt-2 flex flex-col gap-2 ps-3 text-muted-foreground">
                    {tariff.versions.map((version) => (
                      <li key={version.id}>
                        v{version.id}: {version.effectiveFrom} –{" "}
                        {version.effectiveTo ?? "ongoing"} ·{" "}
                        {version.billVerified ? "bill verified" : "unverified"}{" "}
                        · {version.sourceNote}
                        <details className="mt-1">
                          <summary className="cursor-pointer">
                            Rules JSON
                          </summary>
                          <pre className="mt-2 max-h-60 overflow-auto rounded-md border bg-muted/50 p-3 font-sans text-xs tabular-nums">
                            {version.rules}
                          </pre>
                        </details>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )
        ) : (
          <Message>{tariffs.error?.message ?? "Loading tariffs…"}</Message>
        )}
      </div>
      <div className={groupClass}>
        <h3 className={headingClass}>Tariff holidays &amp; monthly rates</h3>
        <Fields>
          <Field label="Inspect tariff">
            <NativeSelect
              size="sm"
              value={tariffId}
              onChange={(e) => setTariffId(e.target.value)}
            >
              <option value="">Select a tariff</option>
              {tariffs.data?.tariffs.map((tariff) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name} (#{tariff.id})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Holiday year">
            <Input
              className="h-8"
              type="number"
              min="2000"
              max="2100"
              value={holidayYear}
              onChange={(e) => setHolidayYear(Number(e.target.value))}
            />
          </Field>
        </Fields>
        {validTariff && (
          <>
            <h4 className={subheadingClass}>Holidays in {holidayYear}</h4>
            {holidays.data ? (
              holidays.data.tariffHolidays.length === 0 ? (
                <EmptyList className="w-full">
                  No holidays listed for {holidayYear}.
                </EmptyList>
              ) : (
                <ul className={listClass}>
                  {holidays.data.tariffHolidays.map((holiday) => (
                    <li key={holiday.date} className={rowClass}>
                      {holiday.date} · {holiday.name}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <Message>
                {holidays.error?.message ?? "Loading holidays…"}
              </Message>
            )}
            <h4 className={subheadingClass}>Monthly rates</h4>
            {monthlyRates.data ? (
              monthlyRates.data.tariffMonthlyRates.length === 0 ? (
                <EmptyList className="w-full">
                  No monthly rates recorded.
                </EmptyList>
              ) : (
                <DataTable containerClassName="w-full">
                  <caption className="sr-only">
                    Monthly rates for tariff #{selectedTariff}
                  </caption>
                  <thead>
                    <Tr>
                      <Th>Month</Th>
                      <Th>Component</Th>
                      <Th>Rate per kWh</Th>
                      <Th>Source</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {monthlyRates.data.tariffMonthlyRates.map((row) => (
                      <Tr key={`${row.month}-${row.componentCode}`}>
                        <Td>{row.month}</Td>
                        <Td>{row.componentCode}</Td>
                        <Td className="tabular-nums">{row.ratePerKwh}</Td>
                        <Td>{row.sourceNote}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
              )
            ) : (
              <Message>
                {monthlyRates.error?.message ?? "Loading monthly rates…"}
              </Message>
            )}
          </>
        )}
      </div>
      {admin && (
        <form
          className={groupClass}
          onSubmit={(e) => {
            e.preventDefault();
            void mutate("CreateTariff", {
              input: {
                name: tariffName,
                currency: tariffCurrency,
                timezone: tariffZone,
              },
            });
          }}
        >
          <h3 className={headingClass}>Create tariff</h3>
          <Fields>
            <Field label="Name">
              <Input
                className="h-8"
                required
                value={tariffName}
                onChange={(e) => setTariffName(e.target.value)}
              />
            </Field>
            <Field label="Currency">
              <Input
                className="h-8"
                required
                value={tariffCurrency}
                onChange={(e) => setTariffCurrency(e.target.value)}
              />
            </Field>
            <Field label="Timezone">
              <Input
                className="h-8"
                required
                value={tariffZone}
                onChange={(e) => setTariffZone(e.target.value)}
              />
            </Field>
          </Fields>
          <Button type="submit" size="sm">
            Create tariff
          </Button>
        </form>
      )}
      {admin && (
        <form
          className={groupClass}
          onSubmit={(e) => {
            e.preventDefault();
            const result = validateTariffJson(rules);
            if (!result.valid) {
              setMessage(result.errors.join("; "));
              return;
            }
            void mutate("CreateTariffVersion", {
              tariffId: Number(tariffId),
              effectiveFrom,
              effectiveTo: effectiveTo || null,
              rules: result.rules,
              sourceNote,
            });
          }}
        >
          <h3 className={headingClass}>Tariff JSON editor</h3>
          <p className={helperClass}>
            Rates, amounts and thresholds in the template are intentionally
            empty. Fill them from the actual bill before saving; no TNB rates
            are assumed.
          </p>
          <Fields>
            <Field label="Tariff ID">
              <Input
                className="h-8"
                type="number"
                min="1"
                required
                value={tariffId}
                onChange={(e) => setTariffId(e.target.value)}
              />
            </Field>
            <Field label="Effective from">
              <Input
                className="h-8"
                type="date"
                required
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <Field label="Effective to (optional)">
              <Input
                className="h-8"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </Field>
            <Field label="Bill/source note">
              <Input
                className="h-8"
                required
                value={sourceNote}
                onChange={(e) => setSourceNote(e.target.value)}
              />
            </Field>
          </Fields>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRules(JSON.stringify(TNB_TEMPLATE, null, 2))}
          >
            TNB RP4 ToU + NEM template
          </Button>
          <label className={cn(fieldClass, "w-full")}>
            Tariff rules JSON
            <textarea
              className={textareaClass}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={18}
              spellCheck={false}
              required
            />
          </label>
          <Button type="submit" size="sm">
            Validate and save tariff version
          </Button>
        </form>
      )}
      {admin && (
        <form
          className={groupClass}
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^-?\d{1,6}(\.\d{1,6})?$/.test(rate)) {
              setMessage(
                "Rate must be a decimal string with at most six fractional digits.",
              );
              return;
            }
            void mutate("SetMonthlyRate", {
              tariffId: Number(tariffId),
              componentCode: rateComponent,
              month: rateMonth,
              ratePerKwh: rate,
              sourceNote: rateNote,
            });
          }}
        >
          <h3 className={headingClass}>Monthly rates</h3>
          <p className={helperClass}>
            Use the tariff ID above. Enter the actual rate from your bill.
          </p>
          <Fields>
            <Field label="Component code">
              <Input
                className="h-8"
                required
                value={rateComponent}
                onChange={(e) => setRateComponent(e.target.value)}
              />
            </Field>
            <Field label="Month">
              <Input
                className="h-8"
                type="month"
                required
                value={rateMonth}
                onChange={(e) => setRateMonth(e.target.value)}
              />
            </Field>
            <Field label="Rate per kWh">
              <Input
                className="h-8"
                required
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
            <Field label="Source note">
              <Input
                className="h-8"
                required
                value={rateNote}
                onChange={(e) => setRateNote(e.target.value)}
              />
            </Field>
          </Fields>
          <Button type="submit" size="sm">
            Save monthly rate
          </Button>
        </form>
      )}
      {admin && editors("tariffs")}
    </Sections>
  );

  const billingBody = () => (
    <Sections>
      <div className={groupClass}>
        <h3 className={headingClass}>Billing periods</h3>
        {periods.data ? (
          periods.data.billingPeriods.edges.length === 0 ? (
            <EmptyList className="w-full">No billing periods.</EmptyList>
          ) : (
            <ul className={listClass}>
              {periods.data.billingPeriods.edges.map(({ node }) => {
                const status = node.result?.status ?? "not calculated";
                return (
                  <li key={node.id} className={rowClass}>
                    #{node.id} · tariff #{node.tariffId} · {node.startDate} –{" "}
                    {node.endDate} ·{" "}
                    <Badge variant="secondary" className={statusTone(status)}>
                      {status}
                    </Badge>
                    {node.stale ? " · stale" : ""}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <Message>
            {periods.error?.message ?? "Loading billing periods…"}
          </Message>
        )}
      </div>
      {admin && editors("billing")}
    </Sections>
  );

  const accountingBody = () => (
    <Sections>
      <div className={groupClass}>
        <h3 className={headingClass}>Accounting policy</h3>
        {policies.data ? (
          policies.data.accountingPolicies.length === 0 ? (
            <EmptyList className="w-full">No accounting policies.</EmptyList>
          ) : (
            <ul className={listClass}>
              {policies.data.accountingPolicies.map((policy) => (
                <li key={policy.version} className={rowClass}>
                  v{policy.version} · effective{" "}
                  {localInstant(policy.effectiveFrom)} · grid{" "}
                  {policy.gridSource}, solar {policy.pvSource}, home{" "}
                  {policy.loadSource}, battery {policy.batterySource} · gap
                  limit {policy.maxGapSec} s · {policy.note}
                </li>
              ))}
            </ul>
          )
        ) : (
          <Message>{policies.error?.message ?? "Loading policies…"}</Message>
        )}
      </div>
      {admin && editors("accounting")}
    </Sections>
  );

  const exclusionsBody = () => (
    <Sections>
      <div className={groupClass}>
        <h3 className={headingClass}>Data exclusions</h3>
        {exclusions.data ? (
          exclusions.data.dataExclusions.length === 0 ? (
            <EmptyList className="w-full">No data exclusions.</EmptyList>
          ) : (
            <ul className={listClass}>
              {exclusions.data.dataExclusions.map((exclusion) => (
                <li key={exclusion.id} className={rowClass}>
                  #{exclusion.id} · {localInstant(exclusion.from)} –{" "}
                  {localInstant(exclusion.to)} · {exclusion.families.join(", ")}{" "}
                  · {exclusion.reason}
                </li>
              ))}
            </ul>
          )
        ) : (
          <Message>
            {exclusions.error?.message ?? "Loading exclusions…"}
          </Message>
        )}
      </div>
      {admin && editors("exclusions")}
      {admin && (
        <div className={groupClass}>
          <h3 className={headingClass}>Delete entries</h3>
          <p className={helperClass}>
            Deletion affects accounting; confirm the ID from your records.
          </p>
          <div className="flex w-full items-end gap-3">
            <Field label="Data exclusion ID" className="flex-1">
              <Input
                className="h-8"
                type="number"
                min="1"
                value={deleteExclusion}
                onChange={(e) => setDeleteExclusion(e.target.value)}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!deleteExclusion}
              onClick={() => {
                if (
                  window.confirm(`Delete data exclusion #${deleteExclusion}?`)
                )
                  void mutate("DeleteDataExclusion", {
                    id: Number(deleteExclusion),
                  });
              }}
            >
              Delete exclusion
            </Button>
          </div>
        </div>
      )}
    </Sections>
  );

  const meterReadingsBody = () => (
    <Sections>
      <div className={groupClass}>
        <h3 className={headingClass}>Meter readings</h3>
        {readings.loaded ? (
          <>
            {readings.readings.length === 0 ? (
              <EmptyList className="w-full">
                No meter readings recorded.
              </EmptyList>
            ) : (
              <ul className={listClass}>
                {readings.readings.map((node) => (
                  <li key={node.id} className={rowClass}>
                    #{node.id} · {localInstant(node.readAt)} · import{" "}
                    {decimal(node.importKwh)} kWh · export{" "}
                    <Reason
                      reason={numericReason(
                        node.exportKwh,
                        null,
                        "Export reading not provided",
                      )}
                    >
                      {node.exportKwh == null
                        ? "—"
                        : `${decimal(node.exportKwh)} kWh`}
                    </Reason>{" "}
                    · {node.source}
                    {admin && (
                      <>
                        {" "}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-1.5 align-middle"
                          onClick={() => setDeleteReading(String(node.id))}
                        >
                          Select #{node.id} for deletion
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <MeterReadingsPager pages={readings} />
          </>
        ) : (
          <Message>
            {readings.error?.message ?? "Loading meter readings…"}
          </Message>
        )}
      </div>
      {admin && editors("meter-readings")}
      {admin && (
        <div className={groupClass}>
          <h3 className={headingClass}>Delete entries</h3>
          <p className={helperClass}>
            Deletion affects accounting; confirm the ID from your records.
          </p>
          <div className="flex w-full items-end gap-3">
            <Field label="Meter reading ID" className="flex-1">
              <Input
                className="h-8"
                type="number"
                min="1"
                value={deleteReading}
                onChange={(e) => setDeleteReading(e.target.value)}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!deleteReading}
              onClick={() => {
                if (window.confirm(`Delete meter reading #${deleteReading}?`))
                  void mutate("DeleteMeterReading", {
                    id: Number(deleteReading),
                  });
              }}
            >
              Delete reading
            </Button>
          </div>
        </div>
      )}
    </Sections>
  );

  const bodies: Record<TileId, () => ReactNode> = {
    connection: connectionBody,
    tariffs: tariffsBody,
    billing: billingBody,
    accounting: accountingBody,
    exclusions: exclusionsBody,
    "meter-readings": meterReadingsBody,
  };

  return (
    <PanelShell
      title="Settings"
      titleId="settings-title"
      contentClassName="px-0 pb-0"
      actions={
        roleNotice && (
          <Badge
            role="status"
            variant="secondary"
            className="h-auto max-w-sm py-0.5 text-start leading-4 whitespace-normal"
          >
            {roleNotice}
          </Badge>
        )
      }
    >
      <div className="grid grid-cols-2 content-start items-stretch border-t-[0.5px] px-6 py-4 min-[914px]:grid-cols-3">
        {tiles.map((tile, index) => (
          <button
            key={tile.id}
            type="button"
            onClick={() => setActive(tile.id)}
            className={cn(
              "group flex h-full min-h-33 select-none flex-col items-start px-5 py-3 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset min-[914px]:min-h-[181px] min-[914px]:px-6 min-[914px]:py-4",
              index < lastRowStart && "border-b-[0.5px] border-border",
            )}
          >
            <span className="flex max-h-18 flex-1 items-center justify-center transition-[filter] group-active:grayscale-50 min-[914px]:max-h-none">
              <img
                src={tile.icon}
                alt=""
                width={52}
                height={52}
                draggable={false}
                className="max-h-16"
              />
            </span>
            <span className="block min-h-14 pt-3 ps-1 min-[914px]:min-h-22.5 min-[914px]:pt-6">
              <span className="block text-sm font-semibold text-foreground">
                {tile.title}
              </span>
              <span className="line-clamp-2 block pt-1.5 text-xs text-gray-400 min-[914px]:pt-2">
                {tile.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      {active === null && message && (
        <div className="px-6 pb-4">
          <Message>{message}</Message>
        </div>
      )}
      {tiles.map((tile) => (
        <SettingsDialog
          key={tile.id}
          open={active === tile.id}
          onClose={() => setActive(null)}
          title={tile.title}
          description={tile.description}
          message={active === tile.id ? message : ""}
        >
          {bodies[tile.id]}
        </SettingsDialog>
      ))}
    </PanelShell>
  );
}
