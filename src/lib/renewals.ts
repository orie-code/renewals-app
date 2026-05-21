import { cached } from "./cache";
import { queryCard, type MetabaseRow } from "./metabase";
import {
  fetchCompaniesWithChargebeeId,
  fetchRenewalDeals,
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
  renewalYear: number | null;
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
  matchedDealRenewalDate: string | null; // ISO YYYY-MM-DD, from the deal's renewal_date property
  renewalDateMatch: "match" | "mismatch" | "missing" | "na";
};

function dealYears(d: RenewalDeal): Set<number> {
  const years = new Set<number>();
  if (d.renewalDate) {
    const y = parseInt(d.renewalDate.slice(0, 4), 10);
    if (Number.isFinite(y)) years.add(y);
  }
  if (d.closeDate) {
    const y = parseInt(d.closeDate.slice(0, 4), 10);
    if (Number.isFinite(y)) years.add(y);
  }
  return years;
}

function pickDealForYear(
  deals: RenewalDeal[] | undefined,
  year: number | null,
): RenewalDeal | undefined {
  if (!deals || deals.length === 0) return undefined;
  if (year == null) return deals[0];
  return deals.find((d) => dealYears(d).has(year));
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
  return cached("hubspot:renewal-deals", TEN_MINUTES, async () => {
    const pipeline = await findRenewalPipeline();
    return fetchRenewalDeals(pipeline);
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
        "hubspot:renewal-deals",
        TEN_MINUTES,
        async () => {
          const pipeline = await findRenewalPipeline();
          return fetchRenewalDeals(pipeline);
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

  // Group renewal deals by HubSpot company id (and by normalized company
  // name as a fallback) — a single company can have multiple deals across
  // years, so we pick the right one per Metabase row by matching year.
  const dealsByCompanyId = new Map<string, RenewalDeal[]>();
  const dealsByCompanyName = new Map<string, RenewalDeal[]>();
  for (const d of deals) {
    if (d.companyId) {
      const arr = dealsByCompanyId.get(d.companyId) ?? [];
      arr.push(d);
      dealsByCompanyId.set(d.companyId, arr);
    }
    if (d.companyName) {
      const key = norm(d.companyName);
      const arr = dealsByCompanyName.get(key) ?? [];
      arr.push(d);
      dealsByCompanyName.set(key, arr);
    }
  }

  // Map Metabase rows to RenewalAccounts (all years, no JS-level filter)
  const accounts: RenewalAccount[] = [];
  for (const row of rawRows) {
    const m = mapMetabaseRow(row);
    if (!m.companyName) continue;

    // Match HubSpot company: prefer CB id, fall back to name
    let hsCompany: HubspotCompany | undefined;
    if (m.cbCustomerId) hsCompany = companyByCb.get(m.cbCustomerId);
    if (!hsCompany) hsCompany = companyByName.get(norm(m.companyName));

    // Match deal: pick the one whose year matches this row, prefer via HS company id
    let deal: RenewalDeal | undefined;
    if (hsCompany) {
      deal = pickDealForYear(dealsByCompanyId.get(hsCompany.hs_object_id), m.renewalYear);
    }
    if (!deal) {
      deal = pickDealForYear(dealsByCompanyName.get(norm(m.companyName)), m.renewalYear);
    }

    accounts.push({
      companyName: m.companyName,
      cbCustomerId: m.cbCustomerId,
      state: m.state,
      arr: m.arr,
      renewalDate: m.renewalDate,
      renewalMonth: m.renewalMonth,
      renewalYear: m.renewalYear,
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
      matchedDealRenewalDate: deal?.renewalDate ?? null,
      renewalDateMatch: !deal
        ? "na"
        : !deal.renewalDate
          ? "missing"
          : m.renewalDate && m.renewalDate === deal.renewalDate
            ? "match"
            : "mismatch",
    });
  }

  accounts.sort((a, b) => {
    const ay = a.renewalYear ?? 9999;
    const by = b.renewalYear ?? 9999;
    if (ay !== by) return ay - by;
    const am = a.renewalMonth ?? 13;
    const bm = b.renewalMonth ?? 13;
    if (am !== bm) return am - bm;
    return a.companyName.localeCompare(b.companyName);
  });

  return accounts;
}
