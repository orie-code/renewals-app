# Renewals dashboard

A Next.js app at `/renewals` that joins Metabase card `3042` (renewal accounts) with HubSpot (2026 renewal deals + companies-with-Chargebee-ID) and tags each account as `covered` or `gap`.

## Local dev

1. Install Node 20+ and run:

   ```bash
   cd renewals-app
   npm install
   ```

2. Copy env and fill in values:

   ```bash
   cp .env.local.example .env.local
   ```

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Then open <http://localhost:3000/renewals>. Append `?refresh=1` to bypass the 10-min server cache.

## Vercel deploy

1. Push this repo to GitHub.
2. In Vercel: **New Project** → import the repo. Framework preset: **Next.js**. Root directory: `renewals-app/` if the repo has other files at root.
3. Under **Settings → Environment Variables**, add (for **Production** and **Preview**):
   - `METABASE_URL` = `https://metabase.vitablehealth.com`
   - `METABASE_USERNAME`
   - `METABASE_PASSWORD`
   - `HUBSPOT_PRIVATE_APP_TOKEN`
4. **Deploy**.
5. After deploy, enable **Vercel Password Protection** under **Settings → Deployment Protection** to gate access.

> Caches are in-memory per Lambda instance, so the first request after a cold start refetches; subsequent requests within 10 minutes on the same instance hit the cache.

## HubSpot private-app scopes

Enable these on the private app whose token you paste into `HUBSPOT_PRIVATE_APP_TOKEN`:

- `crm.objects.companies.read` — read company records (search + batch)
- `crm.objects.deals.read` — read deals (search by pipeline + dealname)
- `crm.schemas.deals.read` — list deal pipelines to find "Renewal Pipeline" by name
- `crm.objects.owners.read` — only needed if you later resolve `hubspot_owner_id` → owner name (not used today; leave off unless you add owner lookups)

## What it does

- **Metabase**: `POST /api/session` to obtain a token, cached in memory and refreshed on 401. Then `POST /api/card/3042/query`, filter rows to renewal-date year == 2026.
- **HubSpot deals**: `GET /crm/v3/pipelines/deals`, find the pipeline labeled "Renewal Pipeline" (case-insensitive). Search deals in that pipeline whose name contains "2026 renewal" (case-insensitive). Batch-read each deal's associated company.
- **HubSpot companies**: paginated search for companies with a non-empty `vitable_chargebee_customer_id`.
- **Join**: each Metabase row is matched to a HubSpot company by CB ID (with a fuzzy lowercase-trimmed name fallback). Then matched to a deal via the HubSpot company id (with a name fallback). Tag `covered` / `gap` accordingly.

## Files

```
src/
  app/
    layout.tsx
    page.tsx                  → redirects to /renewals
    renewals/
      page.tsx                → server component, fetches + renders
      RenewalsView.tsx        → client component, filters + table
    globals.css
  lib/
    cache.ts                  → in-memory TTL cache
    metabase.ts               → session auth + card query
    hubspot.ts                → pipelines, deals, companies
    renewals.ts               → orchestrator + cross-reference
```
