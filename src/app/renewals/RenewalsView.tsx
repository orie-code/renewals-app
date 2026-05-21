"use client";

import { useMemo, useState } from "react";
import type { RenewalAccount } from "@/lib/renewals";

const HUBSPOT_PORTAL_ID = "7460578";

function hubspotCompanyUrl(companyId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-2/${companyId}`;
}

function hubspotDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (v && v.trim()) set.add(v.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Split a comma/plus/slash/&/"and"-separated product list into individual tokens.
function parseProducts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:,|\+|\/|&|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  // YYYY-MM-DD → MMM D, YYYY (UTC, to avoid TZ shifting the day)
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function RenewalsView({ accounts }: { accounts: RenewalAccount[] }) {
  const [month, setMonth] = useState<string>("all");
  const [csms, setCsms] = useState<Set<string>>(new Set());
  const [ae, setAe] = useState<string>("all");
  const [product, setProduct] = useState<string>("all");
  const [productMode, setProductMode] = useState<"include" | "exclude">("include");
  const [dealStage, setDealStage] = useState<string>("all");
  const [dateMatch, setDateMatch] = useState<string>("all");
  const [gapsOnly, setGapsOnly] = useState<boolean>(false);

  const csmOptions = useMemo(() => uniqueSorted(accounts.map((a) => a.csm)), [accounts]);
  const aeOptions = useMemo(() => uniqueSorted(accounts.map((a) => a.ae)), [accounts]);
  const productOptions = useMemo(
    () => uniqueSorted(accounts.flatMap((a) => parseProducts(a.activeProducts))),
    [accounts],
  );
  const dealStageOptions = useMemo(
    () => uniqueSorted(accounts.map((a) => a.matchedDealStage)),
    [accounts],
  );

  const filtered = useMemo(() => {
    const productLc = product.toLowerCase();
    return accounts.filter((a) => {
      if (month !== "all" && String(a.renewalMonth ?? "") !== month) return false;
      if (csms.size > 0 && !csms.has(a.csm ?? "")) return false;
      if (ae !== "all" && (a.ae ?? "") !== ae) return false;
      if (gapsOnly && a.status !== "gap") return false;
      if (dealStage !== "all" && (a.matchedDealStage ?? "") !== dealStage) return false;
      if (dateMatch !== "all" && a.renewalDateMatch !== dateMatch) return false;
      if (product !== "all") {
        const has = parseProducts(a.activeProducts).some(
          (p) => p.toLowerCase() === productLc,
        );
        if (productMode === "include" && !has) return false;
        if (productMode === "exclude" && has) return false;
      }
      return true;
    });
  }, [accounts, month, csms, ae, product, productMode, dealStage, dateMatch, gapsOnly]);

  const totals = useMemo(() => {
    const total = accounts.length;
    const totalArr = accounts.reduce((s, a) => s + a.arr, 0);
    const covered = accounts.filter((a) => a.status === "covered").length;
    const gaps = accounts.filter((a) => a.status === "gap").length;
    const arrAtRisk = accounts
      .filter((a) => a.status === "gap")
      .reduce((s, a) => s + a.arr, 0);
    return { total, totalArr, covered, gaps, arrAtRisk };
  }, [accounts]);

  return (
    <main className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">2026 Renewals</h1>
        <a
          href="/renewals?refresh=1"
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh data
        </a>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total accounts" value={totals.total.toLocaleString()} />
        <StatCard label="Total 2026 ARR" value={fmtUsd(totals.totalArr)} />
        <StatCard label="Covered" value={totals.covered.toLocaleString()} tone="green" />
        <StatCard label="Gaps" value={totals.gaps.toLocaleString()} tone="red" />
        <StatCard label="ARR at risk" value={fmtUsd(totals.arrAtRisk)} tone="red" />
      </section>

      <section className="flex flex-wrap items-end gap-3 bg-white p-4 rounded border border-gray-200">
        <Field label="Month">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>{m}</option>
            ))}
          </select>
        </Field>
        <MultiSelectField
          label="CSM"
          options={csmOptions}
          selected={csms}
          onChange={setCsms}
        />
        <Field label="AE">
          <select
            value={ae}
            onChange={(e) => setAe(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            {aeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Product">
          <div className="flex items-center gap-1">
            <select
              value={productMode}
              onChange={(e) => setProductMode(e.target.value as "include" | "exclude")}
              disabled={product === "all"}
              className="border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="include">includes</option>
              <option value="exclude">excludes</option>
            </select>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="all">Any</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Deal stage">
          <select
            value={dealStage}
            onChange={(e) => setDealStage(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            {dealStageOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Date match">
          <select
            value={dateMatch}
            onChange={(e) => setDateMatch(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all">Any</option>
            <option value="match">Match</option>
            <option value="mismatch">Mismatch</option>
            <option value="missing">Deal missing date</option>
            <option value="na">No deal</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm ml-auto">
          <input
            type="checkbox"
            checked={gapsOnly}
            onChange={(e) => setGapsOnly(e.target.checked)}
          />
          Gaps only
        </label>
      </section>

      <section className="bg-white rounded border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <Th>Company</Th>
              <Th>Renewal date</Th>
              <Th className="text-right">ARR</Th>
              <Th>State</Th>
              <Th>Active products</Th>
              <Th>HubSpot status</Th>
              <Th>Renewal date OK?</Th>
              <Th>Deal stage</Th>
              <Th>CSM</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={`${a.companyName}-${a.cbCustomerId ?? "?"}`} className="border-t border-gray-100">
                <Td>
                  {a.hubspotCompanyId ? (
                    <a
                      href={hubspotCompanyUrl(a.hubspotCompanyId)}
                      target="_blank"
                      rel="noopener"
                      className="text-blue-700 hover:underline"
                    >
                      {a.companyName}
                    </a>
                  ) : (
                    a.companyName
                  )}
                </Td>
                <Td>{fmtDateShort(a.renewalDate)}</Td>
                <Td className="text-right">{fmtUsd(a.arr)}</Td>
                <Td>{a.state ?? "—"}</Td>
                <Td>{a.activeProducts ?? "—"}</Td>
                <Td>
                  {a.status === "covered" ? (
                    a.matchedDealId ? (
                      <a
                        href={hubspotDealUrl(a.matchedDealId)}
                        target="_blank"
                        rel="noopener"
                        title={a.matchedDealName ?? undefined}
                        className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 hover:underline"
                      >
                        covered
                      </a>
                    ) : (
                      <span
                        title={a.matchedDealName ?? undefined}
                        className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800"
                      >
                        covered
                      </span>
                    )
                  ) : a.hubspotCompanyId ? (
                    <a
                      href={hubspotCompanyUrl(a.hubspotCompanyId)}
                      target="_blank"
                      rel="noopener"
                      className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 hover:underline"
                    >
                      no deal
                    </a>
                  ) : (
                    <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                      no deal
                    </span>
                  )}
                </Td>
                <Td><RenewalDateMatchCell account={a} /></Td>
                <Td>
                  {a.matchedDealStage && a.matchedDealId ? (
                    <a
                      href={hubspotDealUrl(a.matchedDealId)}
                      target="_blank"
                      rel="noopener"
                      className="text-blue-700 hover:underline"
                      title={a.matchedDealName ?? undefined}
                    >
                      {a.matchedDealStage}
                    </a>
                  ) : (
                    a.matchedDealStage ?? "—"
                  )}
                </Td>
                <Td>{a.csm ?? "—"}</Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No accounts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={9} className="px-3 py-2 text-xs text-gray-600">
                Showing {filtered.length.toLocaleString()} of {accounts.length.toLocaleString()} accounts
              </td>
            </tr>
          </tfoot>
        </table>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "green" | "red";
}) {
  const toneClasses =
    tone === "green"
      ? "border-green-200"
      : tone === "red"
        ? "border-red-200"
        : "border-gray-200";
  return (
    <div className={`bg-white rounded border ${toneClasses} p-4`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function MultiSelectField({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? Array.from(selected)[0]
        : `${selected.size} selected`;
  return (
    <div className="flex flex-col gap-1 text-xs text-gray-600">
      <span>{label}</span>
      <details className="relative">
        <summary className="list-none cursor-pointer border border-gray-300 rounded px-2 py-1 text-sm bg-white min-w-[140px] flex items-center justify-between gap-2">
          <span className="truncate">{summary}</span>
          <span className="text-gray-400">▾</span>
        </summary>
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded shadow-md p-2 z-10 max-h-64 overflow-auto min-w-[200px]">
          {options.length === 0 ? (
            <div className="text-xs text-gray-500 px-1">No options</div>
          ) : (
            <>
              <div className="flex justify-between text-xs text-blue-600 px-1 pb-1 mb-1 border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => onChange(new Set(options))}
                  className="hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  className="hover:underline"
                >
                  Clear
                </button>
              </div>
              {options.map((opt) => {
                const checked = selected.has(opt);
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2 text-sm py-0.5 px-1 cursor-pointer hover:bg-gray-50 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(selected);
                        if (checked) next.delete(opt);
                        else next.add(opt);
                        onChange(next);
                      }}
                    />
                    <span className="truncate">{opt}</span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

function RenewalDateMatchCell({ account: a }: { account: RenewalAccount }) {
  if (a.renewalDateMatch === "na") {
    return <span className="text-gray-400">—</span>;
  }
  if (a.renewalDateMatch === "match") {
    return (
      <span
        title={`HubSpot: ${fmtDateShort(a.matchedDealRenewalDate)} · Metabase: ${fmtDateShort(a.renewalDate)}`}
        className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800"
      >
        ✓ match
      </span>
    );
  }
  if (a.renewalDateMatch === "missing") {
    return (
      <span
        title={`HubSpot deal has no Renewal Date. Metabase: ${fmtDateShort(a.renewalDate)}`}
        className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800"
      >
        deal missing date
      </span>
    );
  }
  // mismatch
  return (
    <span
      title={`HubSpot: ${fmtDateShort(a.matchedDealRenewalDate)} · Metabase: ${fmtDateShort(a.renewalDate)}`}
      className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800"
    >
      ✗ {fmtDateShort(a.matchedDealRenewalDate)}
    </span>
  );
}
