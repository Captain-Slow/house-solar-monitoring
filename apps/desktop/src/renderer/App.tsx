import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConnectionState } from "@solar/contracts/bridge";
import type {
  CollectorStatusQuery,
  LiveStatusQuery,
} from "@solar/contracts/generated/graphql";
import {
  ChartLine,
  LayoutDashboard,
  ReceiptText,
  Settings as Settings2,
  ShieldCheck,
} from "lucide-react";
import { useSolarQuery } from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { OnboardingSurface } from "./components/onboarding-surface";
import { ShellContext } from "./components/panel-shell";
import { cn } from "./lib/utils";
import { ConnectionScope } from "./connection-scope";
import { ConnectionNotice, Message } from "./components/Display";
import { WindowChrome } from "./components/window-chrome";
import { dashboardStaleness } from "./models";
import { DataQuality } from "./views/DataQuality";
import { History } from "./views/History";
import { Overview } from "./views/Overview";
import { Settings } from "./views/Settings";
import { UsageCost } from "./views/UsageCost";

type Tab =
  "Overview" | "History" | "Usage & Cost" | "Data Quality" | "Settings";
const views: Exclude<Tab, "Settings">[] = [
  "Overview",
  "History",
  "Usage & Cost",
  "Data Quality",
];
const icons = {
  Overview: LayoutDashboard,
  History: ChartLine,
  "Usage & Cost": ReceiptText,
  "Data Quality": ShieldCheck,
};

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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        <span>API token</span>
        <Input
          className="h-8"
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <Button disabled={busy} type="submit" size="sm" className="self-start">
        {busy ? "Testing token…" : "Test collectorStatus and save token"}
      </Button>
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
    <OnboardingSurface>
      <h1 className="text-2xl font-semibold tracking-tight">
        Connect to your solar monitor
      </h1>
      <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
        {[
          "Enter backend URL",
          "Compare and pin its TLS certificate",
          "Test and save your API token",
        ].map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <Badge variant="secondary" aria-hidden>
              {index + 1}
            </Badge>
            {label}
          </li>
        ))}
      </ol>
      {step === "url" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            void probe(event);
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            <span>Backend HTTPS URL</span>
            <Input
              className="h-8"
              type="url"
              required
              value={url}
              placeholder="https://nas.example:port"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={busy}
          >
            Probe certificate
          </Button>
        </form>
      )}
      {step === "fingerprint" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Verify TLS fingerprint</h2>
          <p className="rounded-md border bg-muted/50 p-3 font-sans text-xs tabular-nums break-all">
            {fingerprint}
          </p>
          <p className="text-xs text-muted-foreground">
            compare with the <code>TLS certificate fingerprint</code> line in
            the TrueNAS app log or <code>token.js create</code> output
          </p>
          <p className="text-xs text-muted-foreground">
            Confirm only after comparing this exact fingerprint through a
            trusted channel.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                void pin();
              }}
            >
              I compared it — pin certificate
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStep("url")}
            >
              Change URL
            </Button>
          </div>
        </div>
      )}
      {step === "token" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">API token</h2>
          <TokenEntry onSaved={onSaved} />
        </div>
      )}
      {message && <Message>{message}</Message>}
    </OnboardingSurface>
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
      <OnboardingSurface>
        <h1 className="text-2xl font-semibold tracking-tight">
          House Solar Monitoring
        </h1>
        <Message>Loading connection…</Message>
      </OnboardingSurface>
    );
  if (startupError)
    return (
      <OnboardingSurface>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connection settings unavailable
        </h1>
        <Message>{startupError}</Message>
      </OnboardingSurface>
    );
  if (setup || state?.kind === "NOT_CONFIGURED")
    return <FirstRun onSaved={() => setSetup(false)} />;
  if (state?.kind === "AUTH_FAILED")
    return (
      <OnboardingSurface>
        <h1 className="text-2xl font-semibold tracking-tight">
          Authentication failed
        </h1>
        <p className="text-sm text-muted-foreground">
          The saved token was rejected. Replace it with a valid token.
        </p>
        <TokenEntry onSaved={() => setSetup(false)} />
      </OnboardingSurface>
    );
  if (state?.kind === "TLS_MISMATCH")
    return (
      <OnboardingSurface>
        <h1 className="text-2xl font-semibold tracking-tight">
          TLS certificate mismatch
        </h1>
        <p className="text-sm text-muted-foreground">
          Connection stopped because the presented fingerprint differs from the
          pinned certificate. Verify it against the TrueNAS app log before
          reconfiguring.
        </p>
        <p className="rounded-md border bg-muted/50 p-3 font-sans text-xs tabular-nums break-all">
          Presented fingerprint: {state.presentedFingerprint}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => {
            void window.solar.settings.clear().then(() => {
              setSetup(true);
              setState(null);
            });
          }}
        >
          Forget connection and set up again
        </Button>
      </OnboardingSurface>
    );
  const display = dashboardStaleness(tab, state, live.data?.liveStatus);
  const chipDot =
    state?.kind === "CONNECTED"
      ? "bg-emerald-500"
      : state?.kind === "RECONNECTING"
        ? "bg-amber-500"
        : "bg-muted-foreground";
  const shell = {
    chip: (
      <span role="status">
        <Badge variant="secondary">
          <span
            aria-hidden
            className={cn("me-2 size-2 rounded-full", chipDot)}
          />
          {state?.kind === "CONNECTED"
            ? `Connected · ${state.role}`
            : state?.kind === "RECONNECTING"
              ? "Reconnecting"
              : "Connecting…"}
        </Badge>
      </span>
    ),
    stale: display.greyed && tab !== "Settings",
    notice:
      state?.kind === "RECONNECTING" ? (
        <ConnectionNotice
          state={state}
          lastData={live.data?.liveStatus.observedAt ?? null}
          now={clock.wall}
          serverAgeSeconds={live.data?.liveStatus.ageSeconds}
          elapsedSeconds={(clock.monotonic - lastLiveReceivedAt.current) / 1000}
        />
      ) : undefined,
  };
  const navItem =
    "flex h-[38px] w-full items-center gap-2 rounded-md px-2.5 text-sm text-sidebar-foreground outline-none transition-all duration-200 ease-linear hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-active data-[active=true]:bg-sidebar-active";
  return (
    <ShellContext value={shell}>
      <div className="app-sidebar-wrapper flex h-svh overflow-hidden bg-sidebar">
        <aside className="app-sidebar-inner flex w-[12.5rem] shrink-0 flex-col px-2.5 pt-[55px] pb-4">
          <nav
            aria-label="Dashboard tabs"
            className="flex flex-1 flex-col gap-1"
          >
            {views.map((name) => {
              const Icon = icons[name];
              return (
                <button
                  key={name}
                  type="button"
                  className={navItem}
                  data-active={tab === name}
                  aria-current={tab === name ? "page" : undefined}
                  onClick={() => setTab(name)}
                >
                  <Icon aria-hidden className="size-4" />
                  {name}
                </button>
              );
            })}
          </nav>
          <div className="mb-1 h-px bg-sidebar-border" />
          <button
            type="button"
            className={navItem}
            data-active={tab === "Settings"}
            aria-current={tab === "Settings" ? "page" : undefined}
            onClick={() => setTab("Settings")}
          >
            <Settings2 aria-hidden className="size-4" />
            Settings
          </button>
        </aside>
        <main
          data-transparent={tab === "Overview"}
          className="m-2 ms-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-sidebar-inset shadow-sm data-[transparent=true]:bg-transparent data-[transparent=true]:shadow-none"
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
          {tab === "Data Quality" && (
            <DataQuality siteTimezone={siteTimezone} />
          )}
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
      </div>
    </ShellContext>
  );
}

export function App() {
  return (
    <ConnectionScope>
      <WindowChrome />
      <Dashboard />
    </ConnectionScope>
  );
}
