import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConnectionState } from "@solar/contracts/bridge";
import type {
  CollectorStatusQuery,
  LiveStatusQuery,
} from "@solar/contracts/generated/graphql";
import { useSolarQuery } from "./api";
import { ConnectionScope } from "./connection-scope";
import { ConnectionNotice, Message } from "./components/Display";
import { dashboardStaleness } from "./models";
import { DataQuality } from "./views/DataQuality";
import { History } from "./views/History";
import { Overview } from "./views/Overview";
import { Settings } from "./views/Settings";
import { UsageCost } from "./views/UsageCost";

type Tab =
  "Overview" | "History" | "Usage & Cost" | "Data Quality" | "Settings";
const tabs: Tab[] = [
  "Overview",
  "History",
  "Usage & Cost",
  "Data Quality",
  "Settings",
];

function TokenEntry({ onSaved }: { onSaved: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.current) return;
    const token = input.current.value;
    input.current.value = "";
    setBusy(true);
    try {
      // The main process tests collectorStatus before securely persisting this token.
      const result = await window.solar.settings.saveToken(token);
      if (result.ok) {
        setError("");
        onSaved();
      } else setError(result.message ?? "Token test failed.");
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Token test failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <label>
        API token{" "}
        <input
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <button disabled={busy} type="submit">
        {busy ? "Testing token…" : "Test collectorStatus and save token"}
      </button>
      {error && <Message>{error}</Message>}
    </form>
  );
}

function FirstRun({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [step, setStep] = useState<"url" | "fingerprint" | "token">("url");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function probe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await window.solar.settings.probeCertificate(url);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setFingerprint(result.fingerprint);
      setMessage("");
      setStep("fingerprint");
    } catch (problem) {
      setMessage(
        problem instanceof Error
          ? problem.message
          : "Certificate probe failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function pin() {
    setBusy(true);
    try {
      const result = await window.solar.settings.pinCertificate(
        url,
        fingerprint,
      );
      if (!result.ok) {
        setMessage(result.message ?? "Certificate pin failed.");
        return;
      }
      setStep("token");
      setMessage("");
    } catch (problem) {
      setMessage(
        problem instanceof Error ? problem.message : "Certificate pin failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="setup">
      <h1>Connect to your solar monitor</h1>
      <ol className="steps">
        <li>Enter backend URL</li>
        <li>Compare and pin its TLS certificate</li>
        <li>Test and save your API token</li>
      </ol>
      {step === "url" && (
        <form
          onSubmit={(event) => {
            void probe(event);
          }}
        >
          <label>
            Backend HTTPS URL{" "}
            <input
              type="url"
              required
              value={url}
              placeholder="https://nas.example:port"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Probe certificate
          </button>
        </form>
      )}
      {step === "fingerprint" && (
        <div className="card">
          <h2>Verify TLS fingerprint</h2>
          <p className="fingerprint">{fingerprint}</p>
          <p>
            compare with the <code>TLS certificate fingerprint</code> line in
            the TrueNAS app log or <code>token.js create</code> output
          </p>
          <p>
            Confirm only after comparing this exact fingerprint through a
            trusted channel.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void pin();
            }}
          >
            I compared it — pin certificate
          </button>
          <button type="button" onClick={() => setStep("url")}>
            Change URL
          </button>
        </div>
      )}
      {step === "token" && (
        <div className="card">
          <h2>API token</h2>
          <TokenEntry onSaved={onSaved} />
        </div>
      )}
      {message && <Message>{message}</Message>}
    </main>
  );
}

function Dashboard() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [clock, setClock] = useState({
    wall: Date.now(),
    monotonic: performance.now(),
  });
  const lastLiveReceivedAt = useRef(performance.now());
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const canQuery =
    ready &&
    !setup &&
    state?.kind !== "NOT_CONFIGURED" &&
    state?.kind !== "AUTH_FAILED" &&
    state?.kind !== "TLS_MISMATCH";
  const live = useSolarQuery<LiveStatusQuery>(
    "LiveStatus",
    undefined,
    10_000,
    canQuery,
  );
  const collector = useSolarQuery<CollectorStatusQuery>(
    "CollectorStatus",
    undefined,
    30_000,
    canQuery,
  );
  const siteTimezone = collector.data?.collectorStatus.siteTimezone;
  useEffect(() => {
    if (live.data) lastLiveReceivedAt.current = performance.now();
  }, [live.dataUpdatedAt]);
  useEffect(() => window.solar.onConnectionState(setState), []);
  useEffect(() => {
    void window.solar.settings
      .get()
      .then((settings) => {
        if (
          !settings.backendUrl ||
          !settings.pinnedFingerprint ||
          !settings.hasToken
        )
          setSetup(true);
      })
      .catch((error: unknown) =>
        setStartupError(
          error instanceof Error
            ? error.message
            : "Cannot load connection settings",
        ),
      )
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => setClock({ wall: Date.now(), monotonic: performance.now() }),
      10_000,
    );
    return () => clearInterval(timer);
  }, []);
  if (!ready)
    return (
      <main>
        <h1>House Solar Monitoring</h1>
        <Message>Loading connection…</Message>
      </main>
    );
  if (startupError)
    return (
      <main>
        <h1>Connection settings unavailable</h1>
        <Message>{startupError}</Message>
      </main>
    );
  if (setup || state?.kind === "NOT_CONFIGURED")
    return <FirstRun onSaved={() => setSetup(false)} />;
  if (state?.kind === "AUTH_FAILED")
    return (
      <main className="state-screen">
        <h1>Authentication failed</h1>
        <p>The saved token was rejected. Replace it with a valid token.</p>
        <TokenEntry onSaved={() => setSetup(false)} />
      </main>
    );
  if (state?.kind === "TLS_MISMATCH")
    return (
      <main className="state-screen">
        <h1>TLS certificate mismatch</h1>
        <p>
          Connection stopped because the presented fingerprint differs from the
          pinned certificate. Verify it against the TrueNAS app log before
          reconfiguring.
        </p>
        <p className="fingerprint">
          Presented fingerprint: {state.presentedFingerprint}
        </p>
        <button
          type="button"
          onClick={() => {
            void window.solar.settings.clear().then(() => {
              setSetup(true);
              setState(null);
            });
          }}
        >
          Forget connection and set up again
        </button>
      </main>
    );
  const display = dashboardStaleness(tab, state, live.data?.liveStatus);
  return (
    <>
      <header>
        <h1>House Solar Monitoring</h1>
        <nav aria-label="Dashboard tabs">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <span className="connection">
          {state?.kind === "CONNECTED"
            ? `Connected · ${state.role}`
            : state?.kind === "RECONNECTING"
              ? "Reconnecting"
              : "Connecting…"}
        </span>
      </header>
      {state?.kind === "RECONNECTING" && (
        <ConnectionNotice
          state={state}
          lastData={live.data?.liveStatus.observedAt ?? null}
          now={clock.wall}
          serverAgeSeconds={live.data?.liveStatus.ageSeconds}
          elapsedSeconds={(clock.monotonic - lastLiveReceivedAt.current) / 1000}
        />
      )}
      <main
        className={display.greyed && tab !== "Settings" ? "data-stale" : ""}
      >
        {tab === "Overview" && (
          <Overview
            stale={display.overviewStale}
            lastKnown={display.lastKnown}
            siteTimezone={siteTimezone}
          />
        )}
        {tab === "History" && <History siteTimezone={siteTimezone} />}
        {tab === "Usage & Cost" && <UsageCost siteTimezone={siteTimezone} />}
        {tab === "Data Quality" && <DataQuality siteTimezone={siteTimezone} />}
        {tab === "Settings" && (
          <Settings
            role={state?.kind === "CONNECTED" ? state.role : undefined}
            onReset={() => {
              setSetup(true);
              setState(null);
            }}
          />
        )}
      </main>
    </>
  );
}

export function App() {
  return (
    <ConnectionScope>
      <Dashboard />
    </ConnectionScope>
  );
}
