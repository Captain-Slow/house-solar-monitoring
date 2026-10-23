import { useEffect, useState, type FormEvent } from "react";
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
import { decimal, localInstant, isAdmin, numericReason } from "../models";
import { TNB_TEMPLATE, validateTariffJson } from "../tariff";

type SettingsSnapshot = {
  backendUrl: string | null;
  pinnedFingerprint: string | null;
  hasToken: boolean;
};

type Action = {
  label: string;
  operation: OperationName;
  initial: string;
  variable: string;
  hint: string;
};
const actions: Action[] = [
  {
    label: "Holidays",
    operation: "SetTariffHolidays",
    variable: "holidays",
    hint: 'Enter the tariff ID and year in JSON, with holidays as [{"date":"YYYY-MM-DD","name":"…"}]. This replaces that year’s holiday list.',
    initial: '{\n  "tariffId": null,\n  "year": null,\n  "holidays": []\n}',
  },
  {
    label: "Billing period",
    operation: "UpsertBillingPeriod",
    variable: "input",
    hint: "Local dates mark the start (inclusive) and end (exclusive). Optional bill must be a JSON string accepted by the backend; do not paste an unredacted bill.",
    initial:
      '{\n  "tariffId": null,\n  "startDate": "",\n  "endDate": "",\n  "note": ""\n}',
  },
  {
    label: "Meter reading",
    operation: "AddMeterReading",
    variable: "input",
    hint: "Decimal kWh values must be quoted strings; enter your actual measured utility reading.",
    initial:
      '{\n  "readAt": "",\n  "importKwh": "",\n  "source": "UTILITY_METER_MANUAL",\n  "note": ""\n}',
  },
  {
    label: "Accounting policy",
    operation: "CreateAccountingPolicy",
    variable: "input",
    hint: "Set sources supported by the backend and effective instant; policy changes recalculate historical data.",
    initial:
      '{\n  "effectiveFrom": "",\n  "gridSource": "",\n  "pvSource": "",\n  "loadSource": "",\n  "batterySource": "",\n  "maxGapSec": 0,\n  "note": ""\n}',
  },
  {
    label: "Data exclusion",
    operation: "CreateDataExclusion",
    variable: "input",
    hint: "Enter actual UTC instants and family names for data to exclude.",
    initial:
      '{\n  "from": "",\n  "to": "",\n  "families": [],\n  "reason": ""\n}',
  },
];

function MutationEditor({ action }: { action: Action }) {
  const [text, setText] = useState(action.initial);
  const [message, setMessage] = useState("");
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
    <form className="card" onSubmit={submit}>
      <h3>{action.label}</h3>
      <p>{action.hint}</p>
      <label>
        {action.label} JSON
        <textarea
          value={text}
          rows={Math.max(5, text.split("\n").length + 1)}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </label>
      <button type="submit">Save {action.label.toLowerCase()}</button>
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
  return (
    <section aria-labelledby="settings-title">
      <h2 id="settings-title">Settings</h2>
      <div className="card">
        <h3>Connection</h3>
        <dl className="facts">
          <dt>Backend URL</dt>
          <dd>{config?.backendUrl ?? "—"}</dd>
          <dt>Pinned TLS fingerprint</dt>
          <dd className="fingerprint">{config?.pinnedFingerprint ?? "—"}</dd>
          <dt>Token stored securely</dt>
          <dd>{config?.hasToken ? "Yes" : "No"}</dd>
          <dt>Role</dt>
          <dd>{role ?? "UNKNOWN"}</dd>
        </dl>
        <button
          type="button"
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
        </button>
      </div>
      {!isAdmin(role) && (
        <Message>
          {role === "VIEWER"
            ? "VIEWER access: tariff, readings, and policy changes are hidden."
            : "Role could not be verified; changes are hidden until ADMIN access is confirmed."}
        </Message>
      )}
      {tariffs.data && (
        <div className="card">
          <h3>Configured tariffs</h3>
          <ul>
            {tariffs.data.tariffs.map((tariff) => (
              <li key={tariff.id}>
                #{tariff.id} · {tariff.name} · {tariff.currency} ·{" "}
                {tariff.timezone}
                <ul>
                  {tariff.versions.map((version) => (
                    <li key={version.id}>
                      v{version.id}: {version.effectiveFrom} –{" "}
                      {version.effectiveTo ?? "ongoing"} ·{" "}
                      {version.billVerified ? "bill verified" : "unverified"} ·{" "}
                      {version.sourceNote}
                      <details>
                        <summary>Rules JSON</summary>
                        <pre>{version.rules}</pre>
                      </details>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <h3>Tariff holidays &amp; monthly rates</h3>
        <div className="form-row">
          <label>
            Inspect tariff{" "}
            <select
              value={tariffId}
              onChange={(e) => setTariffId(e.target.value)}
            >
              <option value="">Select a tariff</option>
              {tariffs.data?.tariffs.map((tariff) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name} (#{tariff.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Holiday year{" "}
            <input
              type="number"
              min="2000"
              max="2100"
              value={holidayYear}
              onChange={(e) => setHolidayYear(Number(e.target.value))}
            />
          </label>
        </div>
        {validTariff && (
          <>
            <h4>Holidays in {holidayYear}</h4>
            {holidays.data ? (
              <ul>
                {holidays.data.tariffHolidays.map((holiday) => (
                  <li key={holiday.date}>
                    {holiday.date} · {holiday.name}
                  </li>
                ))}
              </ul>
            ) : (
              <Message>
                {holidays.error?.message ?? "Loading holidays…"}
              </Message>
            )}
            <h4>Monthly rates</h4>
            {monthlyRates.data ? (
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Component</th>
                    <th>Rate per kWh</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRates.data.tariffMonthlyRates.map((row) => (
                    <tr key={`${row.month}-${row.componentCode}`}>
                      <td>{row.month}</td>
                      <td>{row.componentCode}</td>
                      <td>{row.ratePerKwh}</td>
                      <td>{row.sourceNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Message>
                {monthlyRates.error?.message ?? "Loading monthly rates…"}
              </Message>
            )}
          </>
        )}
      </div>
      <div className="card">
        <h3>Billing periods</h3>
        {periods.data ? (
          <ul>
            {periods.data.billingPeriods.edges.map(({ node }) => (
              <li key={node.id}>
                #{node.id} · tariff #{node.tariffId} · {node.startDate} –{" "}
                {node.endDate} · {node.result?.status ?? "not calculated"}
                {node.stale ? " · stale" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <Message>
            {periods.error?.message ?? "Loading billing periods…"}
          </Message>
        )}
      </div>
      <div className="card">
        <h3>Accounting policy</h3>
        {policies.data ? (
          <ul>
            {policies.data.accountingPolicies.map((policy) => (
              <li key={policy.version}>
                v{policy.version} · effective{" "}
                {localInstant(policy.effectiveFrom)} · grid {policy.gridSource},
                solar {policy.pvSource}, home {policy.loadSource}, battery{" "}
                {policy.batterySource} · gap limit {policy.maxGapSec} s ·{" "}
                {policy.note}
              </li>
            ))}
          </ul>
        ) : (
          <Message>{policies.error?.message ?? "Loading policies…"}</Message>
        )}
      </div>
      <div className="card">
        <h3>Data exclusions</h3>
        {exclusions.data ? (
          <ul>
            {exclusions.data.dataExclusions.map((exclusion) => (
              <li key={exclusion.id}>
                #{exclusion.id} · {localInstant(exclusion.from)} –{" "}
                {localInstant(exclusion.to)} · {exclusion.families.join(", ")} ·{" "}
                {exclusion.reason}
              </li>
            ))}
          </ul>
        ) : (
          <Message>
            {exclusions.error?.message ?? "Loading exclusions…"}
          </Message>
        )}
      </div>
      {readings.loaded && (
        <div className="card">
          <h3>Meter readings</h3>
          <ul>
            {readings.readings.map((node) => (
              <li key={node.id}>
                #{node.id} · {localInstant(node.readAt)} · import{" "}
                {decimal(node.importKwh)} kWh · export{" "}
                <span
                  title={numericReason(
                    node.exportKwh,
                    null,
                    "Export reading not provided",
                  )}
                >
                  {node.exportKwh == null
                    ? "—"
                    : `${decimal(node.exportKwh)} kWh`}
                </span>{" "}
                · {node.source}
                {isAdmin(role) && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => setDeleteReading(String(node.id))}
                    >
                      Select #{node.id} for deletion
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <MeterReadingsPager pages={readings} />
        </div>
      )}
      {isAdmin(role) && (
        <>
          <form
            className="card"
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
            <h3>Create tariff</h3>
            <div className="form-row">
              <label>
                Name{" "}
                <input
                  required
                  value={tariffName}
                  onChange={(e) => setTariffName(e.target.value)}
                />
              </label>
              <label>
                Currency{" "}
                <input
                  required
                  value={tariffCurrency}
                  onChange={(e) => setTariffCurrency(e.target.value)}
                />
              </label>
              <label>
                Timezone{" "}
                <input
                  required
                  value={tariffZone}
                  onChange={(e) => setTariffZone(e.target.value)}
                />
              </label>
            </div>
            <button type="submit">Create tariff</button>
          </form>
          <form
            className="card"
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
            <h3>Tariff JSON editor</h3>
            <p>
              Rates, amounts and thresholds in the template are intentionally
              empty. Fill them from the actual bill before saving; no TNB rates
              are assumed.
            </p>
            <div className="form-row">
              <label>
                Tariff ID{" "}
                <input
                  type="number"
                  min="1"
                  required
                  value={tariffId}
                  onChange={(e) => setTariffId(e.target.value)}
                />
              </label>
              <label>
                Effective from{" "}
                <input
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </label>
              <label>
                Effective to (optional){" "}
                <input
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                />
              </label>
              <label>
                Bill/source note{" "}
                <input
                  required
                  value={sourceNote}
                  onChange={(e) => setSourceNote(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => setRules(JSON.stringify(TNB_TEMPLATE, null, 2))}
            >
              TNB RP4 ToU + NEM template
            </button>
            <label>
              Tariff rules JSON
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={18}
                spellCheck={false}
                required
              />
            </label>
            <button type="submit">Validate and save tariff version</button>
          </form>
          <form
            className="card"
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
            <h3>Monthly rates</h3>
            <p>
              Use the tariff ID above. Enter the actual rate from your bill.
            </p>
            <div className="form-row">
              <label>
                Component code{" "}
                <input
                  required
                  value={rateComponent}
                  onChange={(e) => setRateComponent(e.target.value)}
                />
              </label>
              <label>
                Month{" "}
                <input
                  type="month"
                  required
                  value={rateMonth}
                  onChange={(e) => setRateMonth(e.target.value)}
                />
              </label>
              <label>
                Rate per kWh{" "}
                <input
                  required
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
              <label>
                Source note{" "}
                <input
                  required
                  value={rateNote}
                  onChange={(e) => setRateNote(e.target.value)}
                />
              </label>
            </div>
            <button type="submit">Save monthly rate</button>
          </form>
          {actions.map((action) => (
            <MutationEditor key={action.operation} action={action} />
          ))}
          <div className="card">
            <h3>Delete entries</h3>
            <p>
              Deletion affects accounting; confirm the ID from your records.
            </p>
            <div className="form-row">
              <label>
                Meter reading ID{" "}
                <input
                  type="number"
                  min="1"
                  value={deleteReading}
                  onChange={(e) => setDeleteReading(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!deleteReading}
                onClick={() => {
                  if (window.confirm(`Delete meter reading #${deleteReading}?`))
                    void mutate("DeleteMeterReading", {
                      id: Number(deleteReading),
                    });
                }}
              >
                Delete reading
              </button>
            </div>
            <div className="form-row">
              <label>
                Data exclusion ID{" "}
                <input
                  type="number"
                  min="1"
                  value={deleteExclusion}
                  onChange={(e) => setDeleteExclusion(e.target.value)}
                />
              </label>
              <button
                type="button"
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
              </button>
            </div>
          </div>
        </>
      )}
      {message && <Message>{message}</Message>}
    </section>
  );
}
