// Onboarding → Open Enrollment readiness board.
//
// Cross-references the HubSpot Onboarding Pipeline with the Metabase warehouse
// to evaluate, per client in a pre-OE stage, which onboarding steps still
// block open enrollment. TypeScript port of ob-tracker/ob_tracker.py.

import { queryNative } from "./metabase";

const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? "";

const PIPELINE_ID = "28700004"; // Onboarding Pipeline
const PRE_OE_STAGES: Record<string, string> = {
  "65371523": "🌱 Intake",
  "65371524": "👋 In Progress",
  "136631168": "⚽ Ready for kickoff",
  "146139752": "🛑 Blocked",
};
const DEAL_PROPS = [
  "dealname",
  "dealstage",
  "onboarding_status",
  "product_onboarding",
  "hubspot_owner_id",
  "coverage_start",
  "welcome_call_status",
  "welcome_call_scheduled",
  "welcome_call_completed",
  "bank_account_linked_",
  "bank_account_verified",
];
// welcome_call_status values that mean the call step is intentionally waived
const CALL_WAIVED = new Set(["NA", "Self Service", "N/A - see AE Note"]);
const BANK_WAIVED = new Set(["N/A"]);
const COHORT_WINDOW_DAYS = 90;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hs(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!TOKEN) throw new Error("Missing HUBSPOT_PRIVATE_APP_TOKEN env var");
  const maxAttempts = 6;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    if (res.ok) return res.json();
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < maxAttempts) {
      await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
      continue;
    }
    throw new Error(`HubSpot ${path} failed (${res.status}): ${await res.text()}`);
  }
}

type HsDeal = { id: string; properties: Record<string, string | null> };

async function fetchDeals(): Promise<HsDeal[]> {
  const deals: HsDeal[] = [];
  let after: string | undefined;
  while (true) {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: "EQ", value: PIPELINE_ID },
            {
              propertyName: "dealstage",
              operator: "IN",
              values: Object.keys(PRE_OE_STAGES),
            },
          ],
        },
      ],
      properties: DEAL_PROPS,
      limit: 100,
      after,
    };
    const json = (await hs("/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { results: HsDeal[]; paging?: { next?: { after: string } } };
    deals.push(...json.results);
    after = json.paging?.next?.after;
    if (!after) break;
    await sleep(300); // search endpoints are rate-limited ~4/sec
  }
  return deals;
}

async function batchAssociations(
  fromType: string,
  toType: string,
  ids: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const json = (await hs(`/crm/v4/associations/${fromType}/${toType}/batch/read`, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
    })) as { results?: { from: { id: string }; to: { toObjectId: number }[] }[] };
    for (const row of json.results ?? []) {
      out.set(String(row.from.id), row.to.map((t) => String(t.toObjectId)));
    }
  }
  return out;
}

async function batchRead(
  objectType: string,
  ids: string[],
  props: string[],
): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 100) {
    const json = (await hs(`/crm/v3/objects/${objectType}/batch/read`, {
      method: "POST",
      body: JSON.stringify({
        inputs: unique.slice(i, i + 100).map((id) => ({ id })),
        properties: props,
      }),
    })) as { results?: { id: string; properties: Record<string, string | null> }[] };
    for (const row of json.results ?? []) out.set(String(row.id), row.properties);
  }
  return out;
}

async function fetchOwners(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let after: string | undefined;
  while (true) {
    const json = (await hs(
      `/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`,
    )) as {
      results?: { id: string; firstName?: string; lastName?: string; email?: string }[];
      paging?: { next?: { after: string } };
    };
    for (const o of json.results ?? []) {
      const name = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || (o.email ?? "");
      out.set(String(o.id), name);
    }
    after = json.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

// --- meetings → call scheduled / held ------------------------------------

type Meeting = Record<string, string | null>;

async function fetchMeetings(
  dealIds: string[],
): Promise<{ byDeal: Map<string, Meeting[]>; available: boolean }> {
  try {
    const assoc = await batchAssociations("deals", "meetings", dealIds);
    const meetingIds = Array.from(assoc.values()).flat();
    const details = meetingIds.length
      ? await batchRead("meetings", meetingIds, [
          "hs_meeting_title",
          "hs_meeting_start_time",
          "hs_meeting_outcome",
        ])
      : new Map<string, Meeting>();
    const byDeal = new Map<string, Meeting[]>();
    for (const [dealId, mids] of assoc) {
      byDeal.set(
        dealId,
        mids.map((m) => details.get(m)).filter((m): m is Meeting => !!m),
      );
    }
    return { byDeal, available: true };
  } catch {
    // Engagement reads can be scope-restricted; fall back to deal properties.
    return { byDeal: new Map(), available: false };
  }
}

function deriveCallState(meetings: Meeting[]): { scheduled: boolean; held: boolean } {
  const now = new Date().toISOString();
  let held = false;
  let upcoming = false;
  for (const m of meetings) {
    const start = m.hs_meeting_start_time;
    const outcome = (m.hs_meeting_outcome ?? "").toUpperCase();
    if (!start || outcome === "CANCELED" || outcome === "NO_SHOW") continue;
    if (outcome === "COMPLETED" || start < now) held = true;
    else if (start >= now) upcoming = true;
  }
  return { scheduled: held || upcoming, held };
}

// --- warehouse -------------------------------------------------------------

const WAREHOUSE_SQL = (quotedIds: string) => `
SELECT c.hubspot_company_id, c.company_id, c.company_name, c.company_status,
       c.account_executive, c.customer_success_manager,
       c.future_benefit_codes, c.active_benefit_codes,
       c.last_employee_census_upload_date,
       c.has_active_eligibility_policy,
       c.plan_year_configuration_signoff_in,
       c.closest_upcoming_open_enrollment_start_date,
       c.closest_upcoming_coverage_start_date,
       py.future_coverage_start,
       py.latest_coverage_start,
       py.current_or_future_oe_start,
       icc.contribution_class_count
FROM dbt_production.companies c
LEFT JOIN (
    -- active/future plan years per benefit (source of Metabase q3065)
    SELECT company_id,
           MIN(company_benefit_coverage_start_date_est)
               FILTER (WHERE company_benefit_coverage_start_date_est >= CURRENT_DATE) AS future_coverage_start,
           MAX(company_benefit_coverage_start_date_est) AS latest_coverage_start,
           MIN(company_benefit_open_enrollment_start_date_est)
               FILTER (WHERE company_benefit_open_enrollment_end_date_est >= CURRENT_DATE) AS current_or_future_oe_start
    FROM dbt_production.current_company_benefit_enrollment_rates
    GROUP BY 1
) py ON py.company_id = c.company_id
LEFT JOIN (
    SELECT cb.company_id,
           COUNT(cc.ichra_contribution_class_id) AS contribution_class_count
    FROM dbt_production.fct_company_benefits cb
    JOIN dbt_production.stg_asclepius__ichra_contribution_classes cc
      ON cc.ichra_policy_id = cb.ichra_policy_id
    GROUP BY 1
) icc ON icc.company_id = c.company_id
WHERE c.hubspot_company_id IN (${quotedIds})
`;

type WarehouseRow = Record<string, unknown>;

async function fetchWarehouse(companyIds: string[]): Promise<Map<string, WarehouseRow>> {
  const ids = companyIds.filter((i) => /^\d+$/.test(i));
  if (!ids.length) return new Map();
  const rows = await queryNative(3, WAREHOUSE_SQL(ids.map((i) => `'${i}'`).join(", ")));
  const out = new Map<string, WarehouseRow>();
  for (const r of rows) {
    // rows without an ops company_id come from HubSpot only -> not set up in ops
    if (r.company_id) out.set(String(r.hubspot_company_id), r);
  }
  return out;
}

// --- checklist -------------------------------------------------------------

const FAMILY_PATTERNS: [string, RegExp][] = [
  ["ichra", /^ICHRA/],
  ["mec", /^MEC/],
  ["mvp", /^MVP/],
  ["vision-dental", /^(VD|VV)$/],
  ["vpc", /^VPC/],
];

function families(codes: string): string[] {
  const fams = new Set<string>();
  for (const code of codes.split(/[,\s]+/).filter(Boolean)) {
    for (const [fam, pat] of FAMILY_PATTERNS) if (pat.test(code)) fams.add(fam);
  }
  return Array.from(fams).sort();
}

const dateStr = (v: unknown): string => (v ? String(v).slice(0, 10) : "");

// step value: true (done) / false (missing) / null (unknown, manual check) /
// "waived" (not applicable to this client)
export type StepValue = boolean | null | "waived";

export type OnboardingClient = {
  dealId: string;
  name: string;
  stage: string;
  dealType: "new" | "renewal";
  startDate: string | null;
  startFromWarehouse: boolean;
  oeDate: string | null;
  coverageDate: string | null;
  owner: string;
  ae: string;
  families: string[];
  isIchra: boolean;
  inOps: boolean;
  steps: Record<string, StepValue>;
  missing: string[];
  unknown: string[];
  ready: boolean;
};

export type OnboardingBoard = {
  clients: OnboardingClient[];
  filteredOut: number;
  meetingsAvailable: boolean;
  generatedAt: string;
};

function evaluate(
  deal: HsDeal,
  wh: WarehouseRow | undefined,
  meetings: Meeting[],
  meetingsAvailable: boolean,
): Pick<OnboardingClient, "families" | "isIchra" | "inOps" | "steps" | "missing" | "unknown" | "ready"> {
  const p = deal.properties;
  const isRenewal = /renewal/i.test(p.dealname ?? "");
  const codes = [wh?.future_benefit_codes, wh?.active_benefit_codes]
    .filter(Boolean)
    .join(", ");
  let fams = families(codes);
  if (!fams.length && p.product_onboarding) {
    const mapping: Record<string, string> = {
      ICHRA: "ichra",
      MEC: "mec",
      "MEC + MVP": "mec",
      "Primary Care": "vpc",
      "Vision/Dental": "vision-dental",
    };
    fams = Array.from(
      new Set(
        (p.product_onboarding ?? "")
          .split(";")
          .map((s) => mapping[s])
          .filter(Boolean),
      ),
    ).sort();
  }
  const isIchra = fams.includes("ichra");

  const steps: Record<string, StepValue> = {};
  const status = p.welcome_call_status ?? "";
  if (isRenewal || CALL_WAIVED.has(status)) {
    // renewals don't require the welcome call
    steps["Call scheduled"] = "waived";
    steps["Call held"] = "waived";
  } else if (meetingsAvailable && meetings.length) {
    const { scheduled, held } = deriveCallState(meetings);
    steps["Call scheduled"] = scheduled || ["Scheduled", "Completed"].includes(status);
    steps["Call held"] = held || status === "Completed";
  } else {
    steps["Call scheduled"] =
      ["Scheduled", "Completed"].includes(status) || p.welcome_call_scheduled === "Yes";
    steps["Call held"] = status === "Completed" || p.welcome_call_completed === "true";
  }

  if (wh) {
    steps["Ops sign-off"] = !!wh.plan_year_configuration_signoff_in;
    steps["Eligibility policy"] = !!wh.has_active_eligibility_policy;
    steps["Census imported"] = wh.last_employee_census_upload_date != null;
  } else {
    steps["Ops sign-off"] = null;
    steps["Eligibility policy"] = null;
    steps["Census imported"] = null;
  }

  if (isIchra) {
    steps["Contributions calculated"] = wh
      ? Number(wh.contribution_class_count ?? 0) > 0
      : null;
    if (isRenewal) {
      // renewals are already funding through Moov -> bank assumed in place
      steps["Bank linked (Moov)"] = "waived";
      steps["Bank verified (Moov)"] = "waived";
    } else {
      const linked = p.bank_account_linked_ ?? "";
      const verified = p.bank_account_verified ?? "";
      steps["Bank linked (Moov)"] = BANK_WAIVED.has(linked)
        ? "waived"
        : linked === "Yes"
          ? true
          : linked === "No"
            ? false
            : null;
      steps["Bank verified (Moov)"] = BANK_WAIVED.has(verified)
        ? "waived"
        : verified === "Yes"
          ? true
          : ["No", "Verify Issues"].includes(verified)
            ? false
            : null;
    }
  }

  const missing = Object.entries(steps)
    .filter(([, v]) => v === false)
    .map(([k]) => k);
  const unknown = Object.entries(steps)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  return {
    families: fams,
    isIchra,
    inOps: !!wh,
    steps,
    missing,
    unknown,
    ready: !missing.length && !unknown.length && !!wh,
  };
}

export async function fetchOnboardingBoard(): Promise<OnboardingBoard> {
  const deals = await fetchDeals();
  const dealIds = deals.map((d) => String(d.id));

  const [assoc, owners, meetingsRes] = await Promise.all([
    batchAssociations("deals", "companies", dealIds),
    fetchOwners(),
    fetchMeetings(dealIds),
  ]);

  const companyIds = Array.from(new Set(Array.from(assoc.values()).flat()));
  const [whByCompany, companyProps] = await Promise.all([
    fetchWarehouse(companyIds),
    batchRead("companies", companyIds, ["name", "success_owner"]),
  ]);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - COHORT_WINDOW_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  const clients: OnboardingClient[] = [];
  let filteredOut = 0;

  for (const deal of deals) {
    const p = deal.properties;
    const cids = assoc.get(String(deal.id)) ?? [];
    const wh = cids.map((c) => whByCompany.get(c)).find(Boolean);

    // start date priority: warehouse plan years FIRST (future, then latest),
    // HubSpot Contracted Start last. First FRESH candidate wins so a stale
    // date in one source never hides a fresh date in another.
    const hsStart = dateStr(p.coverage_start);
    const candidates: [string, boolean][] = (
      [
        [dateStr(wh?.future_coverage_start), true],
        [dateStr(wh?.closest_upcoming_coverage_start_date), true],
        [dateStr(wh?.latest_coverage_start), true],
        [hsStart, false],
      ] as [string, boolean][]
    ).filter(([d]) => d);
    const fresh = candidates.filter(([d]) => d >= cutoff);
    const [start, startFromWarehouse] = fresh[0] ?? candidates[0] ?? ["", false];

    if (start && start < cutoff) {
      filteredOut++;
      continue;
    }
    // undated deal for a churned client (INACTIVE, nothing upcoming) -> stale
    if (!start && wh && wh.company_status === "INACTIVE" && !wh.future_benefit_codes) {
      filteredOut++;
      continue;
    }

    const ev = evaluate(deal, wh, meetingsRes.byDeal.get(String(deal.id)) ?? [], meetingsRes.available);
    const fallbackName = (p.dealname ?? "")
      .replace(/^\s*(BROKER -\s*)?\w*\s*Onboarding( Renewal)?\s*-\s*/i, "")
      .trim();
    const name =
      (wh?.company_name as string | undefined) ??
      cids.map((c) => companyProps.get(c)?.name).find(Boolean) ??
      (fallbackName || (p.dealname ?? ""));

    // CSM comes from the COMPANY (warehouse CSM, else the company's
    // success_owner resolved to a name) — never from the deal owner.
    const successOwnerRaw = cids
      .map((c) => companyProps.get(c)?.success_owner)
      .find(Boolean);
    const csm =
      (wh?.customer_success_manager as string | undefined) ||
      (successOwnerRaw
        ? owners.get(String(successOwnerRaw)) ?? String(successOwnerRaw)
        : "");

    clients.push({
      dealId: String(deal.id),
      name: String(name).trim(),
      stage: PRE_OE_STAGES[p.dealstage ?? ""] ?? (p.dealstage ?? ""),
      dealType: /renewal/i.test(p.dealname ?? "") ? "renewal" : "new",
      startDate: start || null,
      startFromWarehouse,
      oeDate:
        dateStr(wh?.current_or_future_oe_start) ||
        dateStr(wh?.closest_upcoming_open_enrollment_start_date) ||
        null,
      coverageDate: dateStr(wh?.closest_upcoming_coverage_start_date) || null,
      owner: csm,
      ae: (wh?.account_executive as string | undefined) ?? "",
      ...ev,
    });
  }

  clients.sort((a, b) =>
    (a.oeDate ?? "9999").localeCompare(b.oeDate ?? "9999") ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  return {
    clients,
    filteredOut,
    meetingsAvailable: meetingsRes.available,
    generatedAt: new Date().toISOString(),
  };
}
