import { cached } from "./cache";
import { queryCard, type MetabaseRow } from "./metabase";
import {
  fetchCompaniesWithChargebeeId,
  fetchRenewal2026Deals,
  findRenewalPipeline,
  type HubspotCompany,
  type RenewalDeal,
} from "./hubspot";

const TEN_MINUTES = 10 * 60 * 1000;
const RENEWALS_CARD_ID = 3042;

export type RenewalAccount = {
  companyName: string;
  cbCustomerId: string | null;
  state: string | null;
  arr: number;
  renewalDate: string | null;
  renewalMonth: number | null; // 1-12
  csm: string | null;
  ae: string | null;
  activeProducts: string | null;
  planYearSignOff: string | null;
  enrolledEmployeeCount: number | null;
  enrollmentRate: number | null;

  hubspotCompanyId: string | null;
  status: "covered" | "gap";
  matchedDealId: string | null;
  matchedDealName: string | null;
  matchedDealStage: string | null;
  matchedDealRenewalDate: string | null; // ISO YYYY-MM-DD (effective: renewal_date if in 2026, else closedate)
  matchedDealRenewalDateSource: "renewal_date" | "closedate" | null;
  renewalDateMatch: "match" | "mismatch" | "missing" | "na";
};

// Prefer renewal_date when it falls in 2026; otherwise fall back to closedate.
// This handles deals where renewal_date is stale/blank but closedate reflects
// the real 2026 renewal target.
function effectiveDealDate(deal: RenewalDeal): {
  date: string | null;
  source: "renewal_date" | "closedate" | null;
} {
  if (deal.renewalDate && deal.renewalDate.startsWith("2026")) {
    return { date: deal.renewalDate, source: "renewal_date" };
  }
  if (deal.closeDate && deal.closeDate.startsWith("2026")) {
    return { date: deal.closeDate, source: "closedate" };
  }
  if (deal.renewalDate) return { date: deal.renewalDate, source: "renewal_date" };
  if (deal.closeDate) return { date: deal.closeDate, source: "closedate" };
  return { date: null, source: null };
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return String(v);
}

function pickField(row: MetabaseRow, candidates: string[]): unknown {
  for (const key of candidates) {
    if (key in row) return row[key];
  }
  // case-insensitive fallback
  const lc = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase()] = k;
    return acc;
  }, {});
  for (const key of candidates) {
    const hit = lc[key.toLowerCase()];
    if (hit) return row[hit];
  }
  return null;
}

function parseRenewalDate(v: unknown): { iso: string | null; month: number | null; year: number | null } {
  if (!v) return { iso: null, month: null, year: null };
  const s = String(v);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { iso: s, month: null, year: null };
  return {
    iso: d.toISOString().slice(0, 10),
    month: d.getUTCMonth() + 1,
    year: d.getUTCFullYear(),
  };
}

function mapMetabaseRow(row: MetabaseRow) {
  const companyName = (toStr(pickField(row, ["Company Name", "company_name"])) ?? "").trim();
  const cb = toStr(pickField(row, ["CB Customer ID", "cb_customer_id", "Chargebee Customer ID"]));
  const renewalRaw = pickField(row, ["Renewal Date", "renewal_date"]);
  const { iso, month, year } = parseRenewalDate(renewalRaw);

  return {
    companyName,
    cbCustomerId: cb && cb.trim() ? cb.trim() : null,
    state: toStr(pickField(row, ["State", "state"])),
    arr: toNumber(pickField(row, ["Current Live ARR", "current_live_arr", "ARR"])),
    renewalDate: iso,
    renewalMonth: month,
    renewalYear: year,
    csm: toStr(pickField(row, ["Customer Success Manager", "csm"])),
    ae: toStr(pickField(row, ["Account Executive", "ae"])),
    activeProducts: toStr(pickField(row, ["Active Benefit Products", "active_benefit_products"])),
    planYearSignOff: toStr(pickField(row, ["Plan Year Sign Off", "plan_year_sign_off"])),
    enrolledEmployeeCount: (() => {
      const v = pickField(row, ["Enrolled Employee Count", "enrolled_employee_count"]);
      return v == null ? null : toNumber(v);
    })(),
    enrollmentRate: (() => {
      const v = pickField(row, ["Enrollment Rate", "enrollment_rate"]);
      return v == null ? null : toNumber(v);
    })(),
  };
}

async function loadRawMetabase(): Promise<MetabaseRow[]> {
  return cached("metabase:card:3042", TEN_MINUTES, () => queryCard(RENEWALS_CARD_ID));
}

async function loadDeals(): Promise<RenewalDeal[]> {
  return cached("hubspot:renewal-2026-deals", TEN_MINUTES, async () => {
    const pipeline = await findRenewalPipeline();
    return fetchRenewal2026Deals(pipeline);
  });
}

async function loadCompanies(): Promise<HubspotCompany[]> {
  return cached("hubspot:companies-with-cb", TEN_MINUTES, fetchCompaniesWithChargebeeId);
}

export async function loadRenewals(
  { refresh = false }: { refresh?: boolean } = {},
): Promise<RenewalAccount[]> {
  if (refresh) {
    // Bypass: call underlying loaders with bypass and re-store.
    await Promise.all([
      cached("metabase:card:3042", TEN_MINUTES, () => queryCard(RENEWALS_CARD_ID), { bypass: true }),
      cached(
        "hubspot:renewal-2026-deals",
        TEN_MINUTES,
        async () => {
          const pipeline = await findRenewalPipeline();
          return fetchRenewal2026Deals(pipeline);
        },
        { bypass: true },
      ),
      cached("hubspot:companies-with-cb", TEN_MINUTES, fetchCompaniesWithChargebeeId, { bypass: true }),
    ]);
  }

  const [rawRows, deals, companies] = await Promise.all([
    loadRawMetabase(),
    loadDeals(),
    loadCompanies(),
  ]);

  // Index HubSpot companies by CB id and by normalized name
  const companyByCb = new Map<string, HubspotCompany>();
  const companyByName = new Map<string, HubspotCompany>();
  for (const c of companies) {
    companyByCb.set(c.vitable_chargebee_customer_id, c);
    if (c.name) companyByName.set(norm(c.name), c);
  }

  // Index renewal deals by HubSpot company id and by normalized company name
  const dealByCompanyId = new Map<string, RenewalDeal>();
  const dealByCompanyName = new Map<string, RenewalDeal>();
  for (const d of deals) {
    if (d.companyId) dealByCompanyId.set(d.companyId, d);
    if (d.companyName) dealByCompanyName.set(norm(d.companyName), d);
  }

  // Map + filter Metabase rows to 2026 renewals
  const accounts: RenewalAccount[] = [];
  for (const row of rawRows) {
    const m = mapMetabaseRow(row);
    if (m.renewalYear !== 2026) continue;
    if (!m.companyName) continue;

    // Match HubSpot company: prefer CB id, fall back to name
    let hsCompany: HubspotCompany | undefined;
    if (m.cbCustomerId) hsCompany = companyByCb.get(m.cbCustomerId);
    if (!hsCompany) hsCompany = companyByName.get(norm(m.companyName));

    // Match deal: prefer via HS company id, fall back to name
    let deal: RenewalDeal | undefined;
    if (hsCompany) deal = dealByCompanyId.get(hsCompany.hs_object_id);
    if (!deal) deal = dealByCompanyName.get(norm(m.companyName));

    const eff = deal ? effectiveDealDate(deal) : { date: null, source: null as null };
    accounts.push({
      companyName: m.companyName,
      cbCustomerId: m.cbCustomerId,
      state: m.state,
      arr: m.arr,
      renewalDate: m.renewalDate,
      renewalMonth: m.renewalMonth,
      csm: m.csm,
      ae: m.ae,
      activeProducts: m.activeProducts,
      planYearSignOff: m.planYearSignOff,
      enrolledEmployeeCount: m.enrolledEmployeeCount,
      enrollmentRate: m.enrollmentRate,
      hubspotCompanyId: hsCompany?.hs_object_id ?? null,
      status: deal ? "covered" : "gap",
      matchedDealId: deal?.id ?? null,
      matchedDealName: deal?.name ?? null,
      matchedDealStage: deal?.stageLabel ?? null,
      matchedDealRenewalDate: eff.date,
      matchedDealRenewalDateSource: eff.source,
      renewalDateMatch: !deal
        ? "na"
        : !eff.date
          ? "missing"
          : m.renewalDate && m.renewalDate === eff.date
            ? "match"
            : "mismatch",
    });
  }

  accounts.sort((a, b) => {
    const am = a.renewalMonth ?? 13;
    const bm = b.renewalMonth ?? 13;
    if (am !== bm) return am - bm;
    return a.companyName.localeCompare(b.companyName);
  });

  return accounts;
}
