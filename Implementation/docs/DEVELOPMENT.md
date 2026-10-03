# Development setup

Two ways to work on E-Privacy with hot reload:

| | A. Everything in Docker | B. On the host |
|---|---|---|
| Needs | Docker with Compose ≥ 2.22 | Node ≥ 22.9, npm ≥ 10, plus MySQL (Docker or your own) |
| API reload | restart on save (synced into containers) | restart on save |
| UI reload | Vite HMR on :5173 | Vite HMR on :5173 |
| Good for | "works like production" | debugging with breakpoints, fastest loop |

Both use the same code; nothing needs editing to switch between them. Every command below is run from
`Implementation/` unless stated otherwise.

---

## 0. One-time setup

```bash
git clone <repo-url> E-Privacy
cd E-Privacy/Implementation
cp .env.example .env          # replace every change-me (any values work locally)
npm install                   # workspaces: shared, cloud, owner, web
npm test                      # 4 protocol checks, ~1 s
```

`npm install` is needed for option B and for running tests and the dataset generator on the host. Option A alone does
not need Node on the host.

The dataset `data/hospital_admissions.csv` is committed. To rebuild it (same seed → same bytes):

```bash
npm run dataset               # 540,000 rows
node data/generate.js 20000   # smaller file, handy for quick experiments
```

---

## A. Everything in Docker, with hot reload

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

The first run builds the images (a few minutes). Then:

| URL | What |
|---|---|
| <http://localhost:5173> | the UI through the **Vite dev server** (HMR) |
| <http://localhost:4000> | owner API (direct, for curl/Postman) |
| <http://localhost:5000> | cloud API (direct) |
| `localhost:3307` | MySQL (`MYSQL_USER` / `MYSQL_PASSWORD` from `.env`) |

In this mode the web container runs Vite instead of nginx, so use **:5173**, not :8080.

### What reloads, and how

`docker-compose.dev.yml` uses Compose's `develop.watch`. It **copies** changed files into the running containers,
so no bind mounts are needed. That matters on Docker Desktop, which refuses bind mounts from paths it doesn't share.

| You change | What happens |
|---|---|
| `cloud/src/**`, `owner/src/**` | file synced → `shared/dev/watch.js` restarts that API (~1 s) |
| `shared/**` | synced to all three → both APIs restart, Vite reloads |
| `web/src/**`, `web/index.html` | synced → Vite hot-module reload in the browser |
| any `package.json` | image rebuilt and container replaced |
| `db/schema.sql` | **not** applied automatically, see "Database changes" |
| `data/hospital_admissions.csv` | not synced; `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build owner` |

### Stopping, and going back to the normal stack

`Ctrl+C` stops watching but leaves the containers running in dev mode. To return to the production-style stack
(nginx on :8080):

```bash
docker compose up -d
```

The dev web image has its own tag (`e-privacy-web-dev`), so switching back and forth never mixes up the images.

---

## B. On the host, with hot reload

### 1. A database

Either use the Docker MySQL (easiest, published on port 3307 so it won't clash with a local MySQL on 3306):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql
```

Or your own MySQL 8:

```sql
CREATE DATABASE eprivacy;
CREATE USER 'eprivacy'@'localhost' IDENTIFIED BY 'something';
GRANT ALL ON eprivacy.* TO 'eprivacy'@'localhost';
```
```bash
mysql -u eprivacy -p eprivacy < db/schema.sql
```
(and set `DB_PORT=3306` below).

### 2. Per-service settings

```bash
cp cloud/.env.local.example cloud/.env.local
cp owner/.env.local.example owner/.env.local
```

Fill in the passwords. The pairs that must agree:

| `cloud/.env.local` | must equal |
|---|---|
| `DB_PASSWORD` | the MySQL user's password (`MYSQL_PASSWORD` in `.env` if you use the Docker MySQL) |
| `CLOUD_OWNER_USER` / `CLOUD_OWNER_PASSWORD` | the same two keys in `owner/.env.local` |

`.env.local` files are gitignored and never copied into images. Keys and the signing key go to `cloud/.data/` and
`owner/.data/` (also gitignored), created on first start. `DEFAULT_KEY_BITS=1024` in the owner example keeps
encryption fast while developing; 2048 is ~6× slower.

### 3. Run

Three terminals:

```bash
npm run dev -w cloud          # http://localhost:5000
npm run dev -w owner          # http://localhost:4000
npm run dev -w web            # http://localhost:5173  ← open this
```

`npm run dev -w cloud|owner` runs `shared/dev/watch.js`, which loads `.env.local` and restarts the service when
anything in its `src/` or in `shared/` changes. Vite proxies `/api/cloud` and `/api/owner` to ports 5000/4000; set
`CLOUD_URL` / `OWNER_URL` in the environment to point it elsewhere.

**Debugging.** Run a service directly with the inspector instead of the dev script:

```bash
cd owner && node --env-file=.env.local --inspect src/index.js
```

then attach from VS Code or `chrome://inspect`.

### Why not `node --watch`?

Node's watch mode exchanges messages with every worker thread. `paillier-bigint` generates primes on its own worker
threads and crashes on those messages (`Cannot read properties of undefined (reading 'isPrime')`), so key generation
fails. The small restarter avoids that; see problem log #19 in [problems-and-fixes.md](problems-and-fixes.md).

### Sharing the Docker database between modes

The host cloud generates its **own** board signing key in `cloud/.data/signing.key`. If it writes to the same database
as the Docker cloud, the board ends up signed by two keys and the auditor's log-integrity check fails. Either use a
separate database for host work, or copy the Docker key first:

```bash
mkdir -p cloud/.data
docker compose cp cloud:/var/lib/cloud/signing.key cloud/.data/signing.key
```

The host owner keeps its own keys in `owner/.data/keys`, so campaigns created there don't show up in the Docker
owner (and the other way round). That's by design: private keys never move.

---

## Signing in while developing

| Page | Account (from `.env` / `.env.local`) |
|---|---|
| Records office (hospital) | `OWNER_USER` / `OWNER_PASSWORD` |
| Cloud console, auditor | `AUDITOR_USER` / `AUDITOR_PASSWORD` |
| Cloud console, admin | `ADMIN_USER` / `ADMIN_PASSWORD` |

Owner sessions live in memory, so every owner restart signs you out of the hospital side. The UI notices the 401 and
sends you back to the sign-in page. Cloud sessions are in MySQL and survive restarts.

---

## Database changes

`db/schema.sql` is applied by the MySQL image **only when its data volume is empty**. After editing it:

```bash
docker compose down -v      # wipes ALL volumes: database, board key, hospital keys
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

For a host-side database, drop and recreate it and load the schema again.

---

## Everyday tasks

| Task | Command |
|---|---|
| protocol tests | `npm test` |
| see logs | `docker compose logs -f cloud owner` |
| open a MySQL shell | `docker compose exec mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'` |
| look at the cloud's tables | Database page (admin), or the MySQL shell above |
| see a campaign's plaintext sample | Source data page (hospital), or `GET /api/owner/campaigns/:id/data` |
| make the cloud misbehave | Monitor page (admin) → Fault injection, or `PUT /admin/fault {"mode":"drop"}` |
| production build of the UI | `npm run build -w web` → `web/dist/` |
| start from a clean slate | `docker compose down -v` |

## Where to change what

| Change | Files |
|---|---|
| a new measure or dimension | `shared/protocol.js` (`METRICS`/`DIMENSIONS`), `data/generate.js`; dimensions also need a column in `db/schema.sql` |
| cloud endpoint or policy | `cloud/src/index.js`, `cloud/src/auth.js` |
| how results are verified | `owner/src/campaign.js` (`analyze`) and `web/src/audit.worker.js` |
| a chart | `web/src/charts.js` (shapes), the view that uses it |
| colours, spacing, fonts | `web/src/theme.css`, `web/index.html` |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` for 3307 | `DEV_MYSQL_PORT=3308 docker compose -f … watch`, and the same port in `cloud/.env.local` |
| cloud logs `waiting for database` | MySQL is still initialising (first boot takes ~20 s); it retries for 40 s |
| `Cloud board key changed since it was pinned` | the owner pinned a different cloud key (e.g. after `down -v` of the cloud only). Remove `owner/.data/keys/cloud-board-key.txt` (host) or recreate the `owner_keys` volume |
| auditor: log integrity fails after host work | mixed signing keys, see "Sharing the Docker database" |
| encryption is very slow | use 1024-bit keys and a few hundred rows in development; Docker Desktop is slower than the host (see [performance.md](performance.md)) |
| a new folder under `src/` isn't watched | the restarter watches the folders that existed at start; restart `npm run dev` |
