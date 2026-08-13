"use client";

import { useMemo, useState } from "react";
import type { OnboardingBoard, OnboardingClient, StepValue } from "@/lib/onboarding";

const HUBSPOT_PORTAL_ID = "7460578";
const dealUrl = (id: string) =>
  `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${id}`;

const STEP_ORDER = [
  "Call scheduled",
  "Call held",
  "Ops sign-off",
  "Eligibility policy",
  "Census imported",
  "Contributions calculated",
  "Bank linked (Moov)",
  "Bank verified (Moov)",
];

const STAGES = ["🌱 Intake", "👋 In Progress", "⚽ Ready for kickoff", "🛑 Blocked"];
const SERVICES = ["ichra", "mec", "mvp", "vision-dental", "vpc"];

type SortKey = "name" | "start" | "oe" | "cov";

function sortValue(c: OnboardingClient, key: SortKey): string {
  switch (key) {
    case "name":
      return c.name.toLowerCase();
    case "start":
      return c.startDate ?? "";
    case "oe":
      return c.oeDate ?? "";
    case "cov":
      return c.coverageDate ?? "";
  }
}

function StepCell({ value }: { value: StepValue | undefined }) {
  if (value === true)
    return <td className="text-center font-bold text-emerald-700" title="done">✓</td>;
  if (value === false)
    return <td className="text-center font-bold text-red-700" title="missing">✗</td>;
  if (value === null)
    return <td className="text-center font-bold text-amber-600" title="unknown — needs manual check">?</td>;
  return <td className="text-center text-stone-400" title="not applicable">—</td>;
}

function Progress({ steps }: { steps: Record<string, StepValue> }) {
  const applicable = Object.values(steps).filter((v) => v !== "waived");
  const done = applicable.filter((v) => v === true).length;
  const total = applicable.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[110px]" title={`${done} of ${total} steps done`}>
      <div className="h-2 flex-1 rounded-full bg-vitable-sage overflow-hidden">
        <div
          className={`h-full rounded-full ${pct === 100 ? "bg-emerald-600" : "bg-vitable-green"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-stone-500 whitespace-nowrap">
        {done}/{total}
      </span>
    </div>
  );
}

function Tile({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-5 py-4 min-w-[130px] ${
        accent
          ? "bg-vitable-green border-vitable-green text-vitable-cream"
          : "bg-white border-vitable-sageline"
      }`}
    >
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className={`text-xs mt-0.5 ${accent ? "text-vitable-cream/80" : "text-stone-500"}`}>
        {label}
      </div>
    </div>
  );
}

const inputCls =
  "rounded-lg border border-vitable-sageline bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-vitable-green/30";

export default function OnboardingView({ board }: { board: OnboardingBoard }) {
  const { clients } = board;

  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [service, setService] = useState("");
  const [dealType, setDealType] = useState("");
  const [owner, setOwner] = useState("");
  const [ae, setAe] = useState("");
  const [startFrom, setStartFrom] = useState("");
  const [startTo, setStartTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState(1);

  const owners = useMemo(
    () => Array.from(new Set(clients.map((c) => c.owner).filter(Boolean))).sort(),
    [clients],
  );
  const aes = useMemo(
    () => Array.from(new Set(clients.map((c) => c.ae).filter(Boolean))).sort(),
    [clients],
  );

  const visible = useMemo(() => {
    let rows = clients.filter((c) => {
      const st = c.startDate ?? "";
      return (
        (!q || c.name.toLowerCase().includes(q.toLowerCase())) &&
        (!stage || c.stage === stage) &&
        (!service || c.families.includes(service)) &&
        (!dealType || c.dealType === dealType) &&
        (!owner || c.owner === owner) &&
        (!ae || c.ae === ae) &&
        (!startFrom || (st && st >= startFrom)) &&
        (!startTo || (st && st <= startTo))
      );
    });
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        if (!av && !bv) return 0;
        if (!av) return 1; // blanks always sink to the bottom
        if (!bv) return -1;
        return av < bv ? -sortDir : av > bv ? sortDir : 0;
      });
    }
    return rows;
  }, [clients, q, stage, service, dealType, owner, ae, startFrom, startTo, sortKey, sortDir]);

  const ready = clients.filter((c) => c.ready);
  const readyNew = ready.filter((c) => c.dealType === "new").length;
  const nNew = clients.filter((c) => c.dealType === "new").length;
  const moov = clients.filter((c) =>
    [...c.missing, ...c.unknown].some((s) => s.includes("Bank")),
  ).length;
  const notInOps = clients.filter((c) => !c.inOps).length;

  const header = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer select-none hover:text-vitable-green whitespace-nowrap"
      onClick={() => {
        setSortDir(sortKey === key ? -sortDir : 1);
        setSortKey(key);
      }}
    >
      {label}
      {sortKey === key && <span className="text-[10px]"> {sortDir > 0 ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <main className="min-h-screen bg-vitable-paper px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/vitable-logo.svg" alt="Vitable" className="h-7 mb-3" />
            <h1 className="text-2xl font-semibold text-vitable-green">
              Onboarding → Open Enrollment readiness
            </h1>
            <p className="mt-1 text-xs text-stone-500">
              Updated {new Date(board.generatedAt).toLocaleString()} · pre-OE stages, start
              within 90 days or upcoming · ✓ done · ✗ missing · ? manual check · — n/a ·
              * start date from ops
              {" · "}
              <a href="/onboarding?refresh=1" className="underline hover:text-vitable-green">
                refresh now
              </a>
              {" · "}
              <a href="/renewals" className="underline hover:text-vitable-green">
                renewals board
              </a>
            </p>
            {!board.meetingsAvailable && (
              <p className="mt-1 text-xs text-amber-700">
                ⚠ Meeting data unavailable this load — call steps reflect HubSpot fields only.
              </p>
            )}
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-3">
          <Tile value={clients.length} label="clients in onboarding" accent />
          <Tile value={nNew} label="net new" />
          <Tile value={clients.length - nNew} label="renewals" />
          <Tile
            value={ready.length}
            label={`✓ ready for OE (${readyNew} new · ${ready.length - readyNew} renewal)`}
          />
          <Tile value={clients.length - ready.length} label="✗ have open steps" />
          <Tile value={moov} label="? need Moov check" />
          <Tile value={notInOps} label="? not linked in ops" />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className={inputCls}
            placeholder="Search client…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className={inputCls} value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">All services</option>
            {SERVICES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className={inputCls} value={dealType} onChange={(e) => setDealType(e.target.value)}>
            <option value="">New + renewal</option>
            <option value="new">New only</option>
            <option value="renewal">Renewal only</option>
          </select>
          <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All CSMs</option>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <select className={inputCls} value={ae} onChange={(e) => setAe(e.target.value)}>
            <option value="">All AEs</option>
            {aes.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            Start from
            <input
              type="date"
              className={inputCls}
              value={startFrom}
              onChange={(e) => setStartFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            to
            <input
              type="date"
              className={inputCls}
              value={startTo}
              onChange={(e) => setStartTo(e.target.value)}
            />
          </label>
          <span className="ml-auto text-xs text-stone-400">
            {visible.length} of {clients.length} shown
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-vitable-sageline bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-vitable-sageline bg-vitable-cream text-left text-[11px] uppercase tracking-wide text-vitable-green [&>th]:px-3 [&>th]:py-2.5">
                {header("name", "Client")}
                <th>Services</th>
                {header("start", "Start")}
                {header("oe", "OE start")}
                {header("cov", "Coverage")}
                <th>Progress</th>
                {STEP_ORDER.map((s) => (
                  <th
                    key={s}
                    className="whitespace-nowrap px-1.5 [writing-mode:vertical-rl] rotate-180 text-left"
                  >
                    {s}
                  </th>
                ))}
                <th>Missing / to check</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const openCount = c.missing.length + c.unknown.length;
                return (
                  <tr
                    key={c.dealId}
                    className="border-b border-vitable-sageline/60 align-top last:border-0 hover:bg-vitable-cream/50 [&>td]:px-3 [&>td]:py-2.5"
                  >
                    <td className="min-w-[210px]">
                      <a
                        href={dealUrl(c.dealId)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-vitable-green hover:underline"
                      >
                        {c.name}
                      </a>
                      <div className="mt-0.5 text-[11px] text-stone-500">
                        {c.stage} ·{" "}
                        <span
                          className={
                            c.dealType === "renewal"
                              ? "font-medium text-vitable-berry"
                              : "font-medium text-vitable-green"
                          }
                        >
                          {c.dealType}
                        </span>{" "}
                        · CSM: {c.owner || "—"} · AE: {c.ae || "—"}
                      </div>
                    </td>
                    <td className="min-w-[90px]">
                      {(c.families.length ? c.families : ["?"]).map((f) => (
                        <span
                          key={f}
                          className="mb-0.5 mr-1 inline-block rounded-full border border-vitable-sageline bg-vitable-sage px-2 py-px text-[11px] text-vitable-green"
                        >
                          {f}
                        </span>
                      ))}
                    </td>
                    <td className="whitespace-nowrap text-stone-600">
                      {c.startDate ?? "—"}
                      {c.startFromWarehouse && "*"}
                    </td>
                    <td className="whitespace-nowrap text-stone-600">{c.oeDate ?? "—"}</td>
                    <td className="whitespace-nowrap text-stone-600">{c.coverageDate ?? "—"}</td>
                    <td>
                      <Progress steps={c.steps} />
                    </td>
                    {STEP_ORDER.map((s) => (
                      <StepCell key={s} value={c.steps[s]} />
                    ))}
                    <td className="max-w-[230px] text-xs text-stone-500">
                      {[...c.missing, ...c.unknown.map((u) => `${u} (check)`)].join(", ") || "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      {!c.inOps ? (
                        <span className="rounded-full border border-amber-500 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                          ? Not in ops
                        </span>
                      ) : c.ready ? (
                        <span className="rounded-full border border-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          ✓ Ready for OE
                        </span>
                      ) : (
                        <span className="rounded-full border border-red-600 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          ✗ {openCount} open
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={16} className="px-3 py-10 text-center text-sm text-stone-400">
                    No clients match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
