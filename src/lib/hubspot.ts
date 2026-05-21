const HUBSPOT_BASE = "https://api.hubapi.com";
const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? "";

function authHeaders(): HeadersInit {
  if (!TOKEN) throw new Error("Missing HUBSPOT_PRIVATE_APP_TOKEN env var");
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const maxAttempts = 6;
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(`${HUBSPOT_BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (res.ok) return res;

    // Retry on 429 (rate limit) and transient 5xx.
    const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (retriable && attempt < maxAttempts) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
      const backoffMs = Number.isFinite(retryAfterSec)
        ? Math.max(250, retryAfterSec * 1000)
        : Math.min(8000, 500 * 2 ** (attempt - 1));
      await sleep(backoffMs);
      continue;
    }

    const body = await res.text();
    throw new Error(`HubSpot ${path} failed (${res.status}): ${body}`);
  }
}

// HubSpot search endpoints are capped at ~4 req/sec. Throttle paginated loops
// so we don't trip the secondly limit even before the retry path kicks in.
const SEARCH_PAGE_DELAY_MS = 300;

// HubSpot date-only properties come back as either an ISO `YYYY-MM-DD` string
// or a Unix epoch-millis string (midnight UTC).
function parseHubspotDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Number(s);
  if (Number.isFinite(ms)) {
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// --- Pipelines ---

type PipelineStage = { id: string; label: string; displayOrder?: number };
type Pipeline = { id: string; label: string; stages?: PipelineStage[] };

export type RenewalPipeline = {
  id: string;
  stageLabels: Map<string, string>;
};

function normalizePipelineLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findRenewalPipeline(): Promise<RenewalPipeline> {
  const res = await hsFetch("/crm/v3/pipelines/deals");
  const json = (await res.json()) as { results: Pipeline[] };
  const match = json.results.find(
    (p) => normalizePipelineLabel(p.label) === "renewal pipeline",
  );
  if (!match) {
    throw new Error(
      `No HubSpot deal pipeline named "Renewal Pipeline" found. Available: ${json.results.map((p) => p.label).join(", ")}`,
    );
  }
  const stageLabels = new Map<string, string>();
  for (const s of match.stages ?? []) stageLabels.set(s.id, s.label);
  return { id: match.id, stageLabels };
}

// --- Deals ---

export type RenewalDeal = {
  id: string;
  name: string;
  stageId: string;
  stageLabel: string;
  ownerId: string | null;
  companyId: string | null;
  companyName: string | null;
  renewalDate: string | null; // ISO YYYY-MM-DD, parsed from HubSpot's renewal_date property
};

type DealSearchResult = {
  results: {
    id: string;
    properties: Record<string, string | null>;
    associations?: {
      companies?: {
        results: { id: string; type: string }[];
      };
    };
  }[];
  paging?: { next?: { after: string } };
};

export async function fetchRenewal2026Deals(
  pipeline: RenewalPipeline,
): Promise<RenewalDeal[]> {
  // We pull deals in the Renewal Pipeline that match 2026 by EITHER:
  //   (a) name contains "2026 renewal", or
  //   (b) renewal_date falls in calendar year 2026.
  // (b) catches deals like Oceanwide where the name still says "2025" but
  // the renewal_date has been moved into 2026.
  const dealsById = new Map<string, RenewalDeal>();

  const collect = async (extraFilter: Record<string, unknown>) => {
    let after: string | undefined;
    while (true) {
      const body = {
        filterGroups: [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: pipeline.id },
              extraFilter,
            ],
          },
        ],
        properties: [
          "dealname",
          "dealstage",
          "hubspot_owner_id",
          "pipeline",
          "renewal_date",
        ],
        limit: 100,
        after,
      };
      const res = await hsFetch("/crm/v3/objects/deals/search", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as DealSearchResult;

      for (const d of json.results) {
        if (dealsById.has(d.id)) continue;
        const name = d.properties.dealname ?? "";
        const stageId = d.properties.dealstage ?? "";
        dealsById.set(d.id, {
          id: d.id,
          name,
          stageId,
          stageLabel: pipeline.stageLabels.get(stageId) ?? stageId,
          ownerId: d.properties.hubspot_owner_id ?? null,
          companyId: null,
          companyName: null,
          renewalDate: parseHubspotDate(d.properties.renewal_date),
        });
      }

      if (json.paging?.next?.after) {
        after = json.paging.next.after;
        await sleep(SEARCH_PAGE_DELAY_MS);
      } else {
        break;
      }
    }
  };

  await collect({
    propertyName: "dealname",
    operator: "CONTAINS_TOKEN",
    value: "2026 renewal",
  });
  // HubSpot date properties in search filters take epoch ms at UTC midnight.
  const jan1_2026 = Date.UTC(2026, 0, 1);
  const dec31_2026 = Date.UTC(2026, 11, 31);
  await collect({
    propertyName: "renewal_date",
    operator: "BETWEEN",
    value: String(jan1_2026),
    highValue: String(dec31_2026),
  });

  const deals = Array.from(dealsById.values());

  // Associated company per deal (batch read)
  if (deals.length > 0) {
    const companiesByDeal = await batchReadDealCompanies(deals.map((d) => d.id));
    const allCompanyIds = Array.from(
      new Set(Array.from(companiesByDeal.values()).filter((v): v is string => !!v)),
    );
    const companyNames = await batchReadCompanyNames(allCompanyIds);
    for (const d of deals) {
      const cid = companiesByDeal.get(d.id) ?? null;
      d.companyId = cid;
      d.companyName = cid ? companyNames.get(cid) ?? null : null;
    }
  }

  return deals;
}

async function batchReadDealCompanies(
  dealIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const chunkSize = 100;
  for (let i = 0; i < dealIds.length; i += chunkSize) {
    const chunk = dealIds.slice(i, i + chunkSize);
    const res = await hsFetch(
      "/crm/v4/associations/deals/companies/batch/read",
      {
        method: "POST",
        body: JSON.stringify({
          inputs: chunk.map((id) => ({ id })),
        }),
      },
    );
    const json = (await res.json()) as {
      results: { from: { id: string }; to: { toObjectId: string }[] }[];
    };
    for (const r of json.results) {
      const first = r.to[0]?.toObjectId;
      out.set(r.from.id, first ? String(first) : null);
    }
    for (const id of chunk) if (!out.has(id)) out.set(id, null);
  }
  return out;
}

async function batchReadCompanyNames(
  companyIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const chunkSize = 100;
  for (let i = 0; i < companyIds.length; i += chunkSize) {
    const chunk = companyIds.slice(i, i + chunkSize);
    const res = await hsFetch("/crm/v3/objects/companies/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: ["name"],
        inputs: chunk.map((id) => ({ id })),
      }),
    });
    const json = (await res.json()) as {
      results: { id: string; properties: { name?: string } }[];
    };
    for (const r of json.results) {
      out.set(r.id, r.properties.name ?? "");
    }
  }
  return out;
}

// --- Companies (with CB id) ---

export type HubspotCompany = {
  hs_object_id: string;
  name: string;
  vitable_chargebee_customer_id: string;
  success_owner: string | null;
  account_executive: string | null;
  hubspot_owner_id: string | null;
};

export async function fetchCompaniesWithChargebeeId(): Promise<HubspotCompany[]> {
  const companies: HubspotCompany[] = [];
  let after: string | undefined;
  const props = [
    "name",
    "vitable_chargebee_customer_id",
    "success_owner",
    "account_executive",
    "hubspot_owner_id",
  ];

  while (true) {
    const body = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "vitable_chargebee_customer_id",
              operator: "HAS_PROPERTY",
            },
          ],
        },
      ],
      properties: props,
      limit: 100,
      after,
    };
    const res = await hsFetch("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      results: { id: string; properties: Record<string, string | null> }[];
      paging?: { next?: { after: string } };
    };

    for (const c of json.results) {
      const cbId = c.properties.vitable_chargebee_customer_id;
      if (!cbId) continue;
      companies.push({
        hs_object_id: c.id,
        name: c.properties.name ?? "",
        vitable_chargebee_customer_id: cbId,
        success_owner: c.properties.success_owner ?? null,
        account_executive: c.properties.account_executive ?? null,
        hubspot_owner_id: c.properties.hubspot_owner_id ?? null,
      });
    }

    if (json.paging?.next?.after) {
      after = json.paging.next.after;
      await sleep(SEARCH_PAGE_DELAY_MS);
    } else {
      break;
    }
  }

  return companies;
}
