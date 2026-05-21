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

export default function RenewalsView({ accounts }: { accounts: RenewalAccount[] }) {
  const [month, setMonth] = useState<string>("all");
  const [csm, setCsm] = useState<string>("all");
  const [ae, setAe] = useState<string>("all");
  const [gapsOnly, setGapsOnly] = useState<boolean>(false);

  const csmOptions = useMemo(() => uniqueSorted(accounts.map((a) => a.csm)), [accounts]);
  const aeOptions = useMemo(() => uniqueSorted(accounts.map((a) => a.ae)), [accounts]);

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      if (month !== "all" && String(a.renewalMonth ?? "") !== month) return false;
      if (csm !== "all" && (a.csm ?? "") !== csm) return false;
      if (ae !== "all" && (a.ae ?? "") !== ae) return false;
      if (gapsOnly && a.status !== "gap") return false;
      return true;
    });
  }, [accounts, month, csm, ae, gapsOnly]);

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
        <Field label="CSM">
          <select
            value={csm}
            onChange={(e) => setCsm(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            {csmOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
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
              <Th>Renewal month</Th>
              <Th className="text-right">ARR</Th>
              <Th>State</Th>
              <Th>CSM</Th>
              <Th>AE</Th>
              <Th>Active products</Th>
              <Th>Sign off</Th>
              <Th>Deal stage</Th>
              <Th>HubSpot status</Th>
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
                <Td>{a.renewalMonth ? MONTHS[a.renewalMonth - 1] : "—"}</Td>
                <Td className="text-right">{fmtUsd(a.arr)}</Td>
                <Td>{a.state ?? "—"}</Td>
                <Td>{a.csm ?? "—"}</Td>
                <Td>{a.ae ?? "—"}</Td>
                <Td>{a.activeProducts ?? "—"}</Td>
                <Td>{a.planYearSignOff ?? "—"}</Td>
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
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="p-6 text-center text-gray-500">
                  No accounts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={10} className="px-3 py-2 text-xs text-gray-600">
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
