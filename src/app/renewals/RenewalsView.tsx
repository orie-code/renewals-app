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

// Sentinel option value shown in the Year filter for accounts whose
// Metabase row has no renewal date.
const NO_YEAR_KEY = "__no_year__";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtUsdCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  }
  return fmtUsd(n);
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (v && v.trim()) set.add(v.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function parseProducts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:,|\+|\/|&|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  // Mitigate CSV injection when opened in Excel/Sheets.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(accounts: RenewalAccount[]): string {
  const headers = [
    "Company",
    "Renewal date",
    "ARR",
    "State",
    "CSM",
    "AE",
    "Active products",
    "Enrolled employees",
    "Enrollment rate",
    "Chargebee customer ID",
    "HubSpot status",
    "HubSpot deal name",
    "HubSpot deal stage",
    "HubSpot deal renewal date",
    "Renewal date match",
  ];
  const rows = accounts.map((a) => [
    a.companyName,
    a.renewalDate ?? "",
    a.arr,
    a.state ?? "",
    a.csm ?? "",
    a.ae ?? "",
    a.activeProducts ?? "",
    a.enrolledEmployeeCount ?? "",
    a.enrollmentRate ?? "",
    a.cbCustomerId ?? "",
    a.status,
    a.matchedDealName ?? "",
    a.matchedDealStage ?? "",
    a.matchedDealRenewalDate ?? "",
    a.renewalDateMatch,
  ]);
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

function downloadCsv(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
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
  const [search, setSearch] = useState<string>("");
  const [years, setYears] = useState<Set<string>>(new Set());
  const [months, setMonths] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Set<string>>(new Set());
  const [csms, setCsms] = useState<Set<string>>(new Set());
  const [product, setProduct] = useState<string>("all");
  const [productMode, setProductMode] = useState<"include" | "exclude">("include");
  const [dealStages, setDealStages] = useState<Set<string>>(new Set());
  const [dateMatch, setDateMatch] = useState<string>("all");
  const [gapsOnly, setGapsOnly] = useState<boolean>(false);

  const yearOptions = useMemo(() => {
    const years = uniqueSorted(accounts.map((a) => (a.renewalYear ? String(a.renewalYear) : null)));
    const hasNoYear = accounts.some((a) => a.renewalYear == null);
    return hasNoYear ? [...years, NO_YEAR_KEY] : years;
  }, [accounts]);
  const stateOptions = useMemo(() => uniqueSorted(accounts.map((a) => a.state)), [accounts]);
  const csmOptions = useMemo(() => uniqueSorted(accounts.map((a) => a.csm)), [accounts]);
  const productOptions = useMemo(
    () => uniqueSorted(accounts.flatMap((a) => parseProducts(a.activeProducts))),
    [accounts],
  );
  const dealStageOptions = useMemo(
    () => uniqueSorted(accounts.map((a) => a.matchedDealStage)),
    [accounts],
  );

  const filtersDirty =
    search.trim() !== "" ||
    years.size > 0 ||
    months.size > 0 ||
    states.size > 0 ||
    csms.size > 0 ||
    product !== "all" ||
    dealStages.size > 0 ||
    dateMatch !== "all" ||
    gapsOnly;

  function resetFilters() {
    setSearch("");
    setYears(new Set());
    setMonths(new Set());
    setStates(new Set());
    setCsms(new Set());
    setProduct("all");
    setProductMode("include");
    setDealStages(new Set());
    setDateMatch("all");
    setGapsOnly(false);
  }

  const filtered = useMemo(() => {
    const productLc = product.toLowerCase();
    const searchLc = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (searchLc && !a.companyName.toLowerCase().includes(searchLc)) return false;
      if (years.size > 0) {
        const key = a.renewalYear ? String(a.renewalYear) : NO_YEAR_KEY;
        if (!years.has(key)) return false;
      }
      if (months.size > 0 && !months.has(String(a.renewalMonth ?? ""))) return false;
      if (states.size > 0 && !states.has(a.state ?? "")) return false;
      if (csms.size > 0 && !csms.has(a.csm ?? "")) return false;
      if (gapsOnly && a.status !== "gap") return false;
      if (dealStages.size > 0 && !dealStages.has(a.matchedDealStage ?? "")) return false;
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
  }, [accounts, search, years, months, states, csms, product, productMode, dealStages, dateMatch, gapsOnly]);

  const totals = useMemo(() => {
    const total = filtered.length;
    const totalArr = filtered.reduce((s, a) => s + a.arr, 0);
    const covered = filtered.filter((a) => a.status === "covered").length;
    const gaps = filtered.filter((a) => a.status === "gap").length;
    const arrAtRisk = filtered
      .filter((a) => a.status === "gap")
      .reduce((s, a) => s + a.arr, 0);
    return { total, totalArr, covered, gaps, arrAtRisk };
  }, [filtered]);

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Renewals
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {totals.total.toLocaleString()} of {accounts.length.toLocaleString()} accounts ·{" "}
            {fmtUsdCompact(totals.totalArr)} ARR
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              downloadCsv(`renewals-${today}.csv`, buildCsv(filtered));
            }}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Export ${filtered.length.toLocaleString()} row${filtered.length === 1 ? "" : "s"} to CSV`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
          <a
            href="/renewals?refresh=1"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            Refresh
          </a>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Accounts" value={totals.total.toLocaleString()} />
        <StatCard label="Total ARR" value={fmtUsdCompact(totals.totalArr)} />
        <StatCard label="Covered" value={totals.covered.toLocaleString()} tone="green" />
        <StatCard label="Gaps" value={totals.gaps.toLocaleString()} tone="red" />
        <StatCard label="ARR at risk" value={fmtUsdCompact(totals.arrAtRisk)} tone="red" />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company name…"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <MultiSelectField
            label="Year"
            options={yearOptions}
            selected={years}
            onChange={setYears}
            formatOption={(v) => (v === NO_YEAR_KEY ? "No renewal date" : v)}
          />
          <MultiSelectField
            label="Month"
            options={MONTHS.map((_, i) => String(i + 1))}
            selected={months}
            onChange={setMonths}
            formatOption={(v) => MONTHS[Number(v) - 1] ?? v}
          />
          <MultiSelectField
            label="State"
            options={stateOptions}
            selected={states}
            onChange={setStates}
          />
          <MultiSelectField
            label="CSM"
            options={csmOptions}
            selected={csms}
            onChange={setCsms}
          />
          <Field label="Product">
            <div className="flex items-center gap-1.5">
              <SelectInput
                value={productMode}
                onChange={(v) => setProductMode(v as "include" | "exclude")}
                disabled={product === "all"}
                className="min-w-[100px]"
              >
                <option value="include">includes</option>
                <option value="exclude">excludes</option>
              </SelectInput>
              <SelectInput value={product} onChange={setProduct}>
                <option value="all">Any</option>
                {productOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </SelectInput>
            </div>
          </Field>
          <MultiSelectField
            label="Deal stage"
            options={dealStageOptions}
            selected={dealStages}
            onChange={setDealStages}
          />
          <Field label="Date match">
            <SelectInput value={dateMatch} onChange={setDateMatch}>
              <option value="all">Any</option>
              <option value="match">Match</option>
              <option value="mismatch">Mismatch</option>
              <option value="missing">Deal missing date</option>
              <option value="na">No deal</option>
            </SelectInput>
          </Field>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
              <input
                type="checkbox"
                checked={gapsOnly}
                onChange={(e) => setGapsOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Gaps only
            </label>
            {filtersDirty && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-sm font-medium text-slate-500 hover:text-slate-900"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a) => (
                <tr
                  key={`${a.companyName}-${a.cbCustomerId ?? "?"}`}
                  className="transition-colors hover:bg-slate-50/60"
                >
                  <Td className="font-medium text-slate-900">
                    {a.hubspotCompanyId ? (
                      <a
                        href={hubspotCompanyUrl(a.hubspotCompanyId)}
                        target="_blank"
                        rel="noopener"
                        className="text-indigo-700 hover:text-indigo-900 hover:underline"
                      >
                        {a.companyName}
                      </a>
                    ) : (
                      a.companyName
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-700">{fmtDateShort(a.renewalDate)}</Td>
                  <Td className="text-right tabular-nums font-medium text-slate-900">{fmtUsd(a.arr)}</Td>
                  <Td className="text-slate-700">{a.state ?? "—"}</Td>
                  <Td className="text-slate-700">{a.activeProducts ?? "—"}</Td>
                  <Td>
                    {a.status === "covered" ? (
                      a.matchedDealId ? (
                        <a
                          href={hubspotDealUrl(a.matchedDealId)}
                          target="_blank"
                          rel="noopener"
                          title={a.matchedDealName ?? undefined}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          covered
                        </a>
                      ) : (
                        <span
                          title={a.matchedDealName ?? undefined}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          covered
                        </span>
                      )
                    ) : a.hubspotCompanyId ? (
                      <a
                        href={hubspotCompanyUrl(a.hubspotCompanyId)}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        no deal
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
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
                        className="text-indigo-700 hover:text-indigo-900 hover:underline"
                        title={a.matchedDealName ?? undefined}
                      >
                        {a.matchedDealStage}
                      </a>
                    ) : (
                      <span className="text-slate-400">{a.matchedDealStage ?? "—"}</span>
                    )}
                  </Td>
                  <Td className="text-slate-700">{a.csm ?? "—"}</Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-sm text-slate-500">
                    No accounts match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          Showing <span className="font-medium text-slate-700">{filtered.length.toLocaleString()}</span> of {accounts.length.toLocaleString()} accounts
        </div>
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
  const accent =
    tone === "green"
      ? "before:bg-emerald-500"
      : tone === "red"
        ? "before:bg-rose-500"
        : "before:bg-slate-300";
  const valueColor =
    tone === "green"
      ? "text-emerald-700"
      : tone === "red"
        ? "text-rose-700"
        : "text-slate-900";
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${accent}`}
    >
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tracking-tight tabular-nums ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  children,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`min-w-[140px] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    >
      {children}
    </select>
  );
}

function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  formatOption,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  formatOption?: (opt: string) => string;
}) {
  const fmt = formatOption ?? ((o: string) => o);
  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? fmt(Array.from(selected)[0])
        : `${selected.size} selected`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <details className="relative">
        <summary className="flex min-w-[140px] cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm hover:border-slate-400">
          <span className={`truncate ${selected.size === 0 ? "text-slate-500" : ""}`}>
            {summary}
          </span>
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[220px] max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-slate-500">No options</div>
          ) : (
            <>
              <div className="mb-1 flex justify-between border-b border-slate-100 px-1.5 pb-1.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => onChange(new Set(options))}
                  className="text-indigo-600 hover:text-indigo-800"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  className="text-slate-500 hover:text-slate-800"
                >
                  Clear
                </button>
              </div>
              {options.map((opt) => {
                const checked = selected.has(opt);
                return (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
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
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="truncate">{fmt(opt)}</span>
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
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

function RenewalDateMatchCell({ account: a }: { account: RenewalAccount }) {
  if (a.renewalDateMatch === "na") {
    return <span className="text-slate-400">—</span>;
  }
  if (a.renewalDateMatch === "match") {
    return (
      <span
        title={`HubSpot: ${fmtDateShort(a.matchedDealRenewalDate)} · Metabase: ${fmtDateShort(a.renewalDate)}`}
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
      >
        ✓ match
      </span>
    );
  }
  if (a.renewalDateMatch === "missing") {
    return (
      <span
        title={`HubSpot deal has no Renewal Date. Metabase: ${fmtDateShort(a.renewalDate)}`}
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
      >
        missing date
      </span>
    );
  }
  return (
    <span
      title={`HubSpot: ${fmtDateShort(a.matchedDealRenewalDate)} · Metabase: ${fmtDateShort(a.renewalDate)}`}
      className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
    >
      ✗ {fmtDateShort(a.matchedDealRenewalDate)}
    </span>
  );
}
