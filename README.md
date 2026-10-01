# Upshift

Public app: [upshift.upshift-practice.workers.dev](https://upshift.upshift-practice.workers.dev/)

The app runs on Cloudflare Workers with a D1 database. The [previous Sites deployment](https://catgirl-donaldgera-practice.donald-gera-personal.chatgpt.site/) remains available as a fallback; future Cloudflare deployments do not update that older copy.

## Using the app

1. Enter **Your handle**, add 1–5 **Learn from** handles, and choose **Any source** (union) or **All sources** (intersection).
2. **Build queue** validates current handles and loads complete public Codeforces submission histories. Your accepted problems move into **Already solved**. Each problem appears once.
3. Default sorting uses the earliest accepted submission among selected sources, oldest first. **Oldest source solve** and **Newest source solve** use this source date in both tabs. Rows link to the problem and every contributing source’s first acceptance. Completed rows also show and link to your acceptance.
4. Both tabs have independent search, inclusive minimum/maximum ratings, topic and sort controls. Blank bounds include unrated problems; a bound excludes them. The completed minimum implements `rating >= x`.
5. The random picker uses the **entire unsolved queue** and its own inclusive minimum and maximum ratings. Both bounds are required; equal bounds select an exact rating. Existing saved maximum ratings are preserved, with a minimum of zero. It excludes unrated problems and avoids the previous recommendation when another is eligible.
6. **Refresh** bypasses caches, refetches histories and ratings, and preserves settings. Progress reports stages and submission counts. Failed/cancelled refreshes preserve the previous complete result and timestamp.

**Show ratings** hides or reveals individual ratings in both tabs and the random recommendation. Hiding removes rating values from the rendered content and accessibility tree; rating filters and the random range remain available and continue to apply. The preference is saved in this browser. It is a display preference, not a restriction on the underlying public Codeforces data.

**Show tags** reveals or hides tags in both problem lists. Tags are hidden by default, including for existing visitors who have not chosen a preference. Hidden tags are omitted from rendered rows and the accessibility tree; the topic filter still works. The choice persists across reloads and data refreshes.

**Appearance** offers System, Light, and Dark. System follows live device-theme changes; an explicit theme stays selected. This preference is saved separately in this browser and applied before the page is painted. Upshift uses a violet stepped favicon and neutral charcoal surfaces inspired by NeetCode's palette. The violet **To solve** statistic highlights the queue count; it does not indicate a rating or completion status.

Preferences and the last complete comparison are device-local browser storage. Visitors do not share selections; people sharing one browser profile share that profile’s preferences. No login or cross-device sync. Clearing browser data removes preferences. Storage quotas can prevent saving unusually large comparisons; live results still work.

The Cloudflare address is a new browser origin. Handles, themes, filters, rating/tag visibility, random ranges, and saved results from the older Sites address do **not** migrate automatically. Set your preferences once at the new address; each address then remembers its own choices.

## Architecture and correctness

- `lib/comparison.mjs`: shared pure domain logic. Accepts only verdict `OK`; identity is `(contestId,index)` or the named problem set. Earliest solve and submission link use the same record. Ties use submission ID then handle. Learner acceptance excludes a problem from the queue.
- `server/codeforces.mjs`: validates through `user.info` with historic aliases disabled, pages `user.status` through an empty terminal page, deduplicates submissions and supplements metadata with problem/Gym catalogs. Short pages are not assumed terminal. Partial or repeated pages fail without producing a partial queue.
- `server/worker.mjs`: same-origin JSON POST `/api/compare`, streaming NDJSON progress/result/error, plus frontend assets. Only fixed Codeforces endpoints are fetched. No API keys are required.
- `server/rate-limit.mjs`: D1 atomic reservations coordinate API starts across Workers at 2.4-second intervals. A 45-second backlog rejects excess work; retries back off. Database failure fails closed.
- Public histories are cached per edge location for 15 minutes; metadata for six hours. Force refresh bypasses TTLs. Concurrent requests in one isolate share history work. The displayed timestamp is the **oldest history retrieval time used**, never a cached render time.
- Limits: five source handles, 250,000 submissions and 30,000 solved problems per handle, 60,000 combined source problems. Oversized histories fail explicitly. Four simultaneous comparisons per isolate and one per client IP in each isolate limit bursts. API pacing is global; caching and in-flight deduplication are per isolate/location.
- Timeout: eight minutes. Cancelling releases the comparison; a started shared history may finish for the server cache. Codeforces availability, rate limits, private contests, and rejudging affect data. Pagination is not an atomic snapshot if submissions change during a fetch.

The database contains only an API pacing clock. Queries use prepared statements. The frontend escapes rendered text and sends restrictive security headers. No telemetry, external fonts or private account data.

## Automatic refresh and daily agent

Open pages check periodically and when revisited. A comparison older than 24 hours refreshes automatically if handles have not changed. Failed automatic attempts are spaced at least 15 minutes apart. Closed browsers cannot execute page JavaScript.

The existing Codex daily agent is configured for **09:00 Europe/Rome**, but is **currently paused** and has not been resumed during this migration. While paused, it performs no scheduled refreshes.

When resumed, it runs `npm.cmd run refresh`, requests a fresh hosted comparison for donaldgera/catgirl, and atomically updates `.cache/latest-comparison.json`. It retains the last successful file on failure, retries transient failures once, and stays quiet except when the queue is empty, refreshing fails after retry, or user action is required. This local schedule requires the computer and Codex to be running. It does not rebuild or deploy static snapshots. Custom visitor selections refresh in their own pages; the daily agent never changes their settings. Page auto-refresh remains independent of the paused agent.

## Local development

Node.js 24+ (preview uses built-in SQLite). Production Worker code has no npm runtime dependencies; Drizzle is a development dependency for generated migrations.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Open [the local preview](http://127.0.0.1:4173/). Preview runs the same bundled Worker, real Codeforces requests and an in-memory SQLite pacing clock. Keep one preview instance. Rebuild and restart preview after editing frontend or server files; the preview imports the bundle at startup. No secrets or manual backend setup required.

To run the daily check against preview:

```powershell
$env:PRACTICE_URL = 'http://127.0.0.1:4173'
npm.cmd run refresh
```

Optional CLI settings: `PRACTICE_LEARNER`, comma-separated `PRACTICE_SOURCES`, and `PRACTICE_MODE`. The CLI never writes deployment artifacts. Legacy `scripts/core.mjs` remains for regression tests only.

## Publishing future updates

`wrangler.jsonc` is a deployment template for the **upshift** Worker and **upshift-api** database. Copy it to the ignored `wrangler.local.jsonc` and replace the account and database placeholders with your own identifiers. The deployment scripts automatically use this local file when present. The original checkout already has its local configuration. The Worker serves both frontend assets and `/api/compare` from the same address. D1 stores only the API pacing clock; visitor preferences stay in the browser.

1. Edit `src/public.html`, `src/style.css`, `src/app.js`, or domain/server files. For schema changes, edit `db/schema.ts`, run `npm.cmd run db:generate`, and inspect SQL. Never change applied migrations or their metadata.
2. Run `npm.cmd run deploy:check` to build and validate a deployment with Wrangler's dry run. This does not publish or apply remote migrations. Verify the UI in local preview.
3. Run `npm.cmd run deploy`. This runs tests, builds `dist/server/index.js`, applies pending D1 migrations to the remote `DB`, and deploys the Worker. It stops if an earlier command fails. Review schema changes before running it because migrations affect the live database.
4. Wait for successful completion and check the displayed public URL. Verify the public page, `/api/health`, and a complete `/api/compare` result after backend changes; an HTTP 200 alone does not prove a streamed comparison succeeded.
5. Commit source, lockfile, migrations, and the deployment template. Generated bundles, real deployment configuration, caches, and credentials are excluded from Git.

Wrangler is installed as a project development dependency. Deployment uses the authenticated Cloudflare account. On a new computer or after authorization expires, install dependencies with `npm.cmd ci`, run `npx.cmd wrangler login`, then confirm the intended account with `npx.cmd wrangler whoami` before deployment. No Codeforces API key or separate backend service is required.

The ignored `.openai` hosting files remain locally for the legacy Sites fallback; a GitHub clone builds without them. Normal updates use the Cloudflare commands above. Do not overwrite `dist` with retired static snapshots or deploy solely to refresh problem data.

For a separate deployment from a fresh clone, authenticate Wrangler, create your own D1 database with `npx.cmd wrangler d1 create upshift-api`, and put the returned database ID and your account ID into `wrangler.local.jsonc`. Choose an available Worker name and database name for your account. Then run `npm.cmd run deploy`. Do not commit the local configuration or authentication tokens.

## Hosting costs and limits

The `workers.dev` address requires no purchased domain. Cloudflare Workers Free includes **100,000 requests/day** and **10 ms CPU time per invocation**. This app currently serves frontend assets through Worker code, so those requests also use its request allowance. CPU time is distinct from time waiting on Codeforces; large comparisons can still reach the CPU limit. Workers Paid starts at **US$5/month**, with usage charges beyond its included allowance. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

D1's free allowance is **5 million rows read/day**, **100,000 rows written/day**, and **5 GB total storage**. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). These published limits were checked on 2026-10-01; verify current pricing before changing plans. No paid plan or custom domain is needed for the current address.

## Cloudflare tools in Codex

Cloudflare's development skills are installed, and its main `cloudflare` MCP server is authenticated. The documentation, bindings, builds, and observability MCP servers are registered. Restart Codex to load the new server configuration; specialized servers that require authentication can request login when first used. Wrangler's deployment login and MCP authorization are separate. These agent tools help maintain the project but are not required for visitors to use the app.

## Verification

`npm test` covers accepted-only uniqueness, union/intersection, chronology and submission links, newly completed problems, rating/unrated boundaries, recommendation repeats, pagination, partial-failure cache protection, mode switching, force refresh, coalescing, cancellation, API validation/streaming and atomic pacing. Browser verification covers add/remove/duplicate handles, queue generation, completed filters, random picks, refresh/persistence and desktop/mobile layout.

Official references: [Codeforces API](https://codeforces.com/apiHelp) and [API methods](https://codeforces.com/apiHelp/methods).
