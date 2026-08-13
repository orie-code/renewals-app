const METABASE_URL = process.env.METABASE_URL ?? "";
const METABASE_USERNAME = process.env.METABASE_USERNAME ?? "";
const METABASE_PASSWORD = process.env.METABASE_PASSWORD ?? "";

let sessionTokenPromise: Promise<string> | null = null;

async function fetchSessionToken(): Promise<string> {
  if (!METABASE_URL || !METABASE_USERNAME || !METABASE_PASSWORD) {
    throw new Error(
      "Missing METABASE_URL / METABASE_USERNAME / METABASE_PASSWORD env vars",
    );
  }
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: METABASE_USERNAME,
      password: METABASE_PASSWORD,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Metabase session login failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

async function getSessionToken(forceRefresh = false): Promise<string> {
  if (forceRefresh || !sessionTokenPromise) {
    sessionTokenPromise = fetchSessionToken().catch((err) => {
      sessionTokenPromise = null;
      throw err;
    });
  }
  return sessionTokenPromise;
}

async function metabaseFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = async (token: string) =>
    fetch(`${METABASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
        "X-Metabase-Session": token,
      },
      cache: "no-store",
    });

  let token = await getSessionToken();
  let res = await send(token);
  if (res.status === 401) {
    token = await getSessionToken(true);
    res = await send(token);
  }
  return res;
}

export type MetabaseRow = Record<string, unknown>;

// Run a raw native SQL query against a database (same shape as /api/dataset).
// Keys are the raw column names (not display names).
export async function queryNative(
  databaseId: number,
  sql: string,
): Promise<MetabaseRow[]> {
  const res = await metabaseFetch(`/api/dataset`, {
    method: "POST",
    body: JSON.stringify({
      database: databaseId,
      type: "native",
      native: { query: sql },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Metabase native query failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as {
    status?: string;
    error?: string;
    data: { rows: unknown[][]; cols: { name: string }[] };
  };
  if (json.status === "failed") {
    throw new Error(`Metabase native query failed: ${json.error}`);
  }
  const { rows, cols } = json.data;
  return rows.map((row) => {
    const obj: MetabaseRow = {};
    cols.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });
}

export async function queryCard(cardId: number): Promise<MetabaseRow[]> {
  const res = await metabaseFetch(`/api/card/${cardId}/query`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Metabase card ${cardId} query failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as {
    data: {
      rows: unknown[][];
      cols: { name: string; display_name?: string }[];
    };
  };
  const { rows, cols } = json.data;
  return rows.map((row) => {
    const obj: MetabaseRow = {};
    cols.forEach((col, i) => {
      const key = col.display_name ?? col.name;
      obj[key] = row[i];
    });
    return obj;
  });
}
