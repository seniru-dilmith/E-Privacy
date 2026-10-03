# Docker, networks and environment

## One compose file, one Dockerfile per service

| Service | Dockerfile | Image contents | Published |
|---|---|---|---|
| `mysql` | `db/Dockerfile` | `mysql:8.4` + `schema.sql` in `docker-entrypoint-initdb.d` | no |
| `cloud` | `cloud/Dockerfile` | `node:22-alpine`, workspace deps for cloud + shared, cloud and shared sources | no |
| `owner` | `owner/Dockerfile` | `node:22-alpine`, deps for owner + shared, sources, **and the CSV at `/data`** | no |
| `web` | `web/Dockerfile` | build stage (Node, Vite) → `nginx:1.27-alpine` with `dist/` and `nginx.conf` | `${WEB_PORT}:80` |

All builds use `Implementation/` as the context so the npm workspace lockfile and `shared/` are available. Every Node
Dockerfile copies all four workspace `package.json` files first (npm needs them to validate the lockfile), runs
`npm ci -w <service> -w shared`, then copies sources, so dependency layers are cached across code changes.
The node services run as the unprivileged `node` user.

## Networks

```
cloud_net:  mysql ── cloud
edge:       cloud ── owner ── web
```

MySQL is only on `cloud_net`: the owner and web containers cannot reach it at all. The owner reaches the cloud over
`edge`, exactly like any other API client.

## Volumes

| Volume | Mounted at | Contains |
|---|---|---|
| `mysql_data` | mysql `/var/lib/mysql` | the database |
| `cloud_keys` | cloud `/var/lib/cloud` | the board's P-256 signing key |
| `owner_keys` | owner `/keys` | Paillier keys, leaf hashes, receipts, pinned board key |

`docker compose down` keeps them; `docker compose down -v` wipes everything (a fresh deployment, new board key).

## Environment

`.env` sits next to `docker-compose.yml` (gitignored); `.env.example` is the committed template. Compose passes each
service **only** the variables it needs:

| Variable | mysql | cloud | owner | web |
|---|:-:|:-:|:-:|:-:|
| `MYSQL_ROOT_PASSWORD` | ✓ | | | |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | ✓ | ✓ (as `DB_*`) | | |
| `K_MIN`, `SESSION_TTL_HOURS` | | ✓ | | |
| `AUDITOR_*`, `ADMIN_*` | | ✓ | | |
| `CLOUD_OWNER_USER`, `CLOUD_OWNER_PASSWORD` | | ✓ (to create the account) | ✓ (to sign in) | |
| `OWNER_USER`, `OWNER_PASSWORD`, `DEFAULT_KEY_BITS` | | | ✓ | |
| `WEB_PORT` | | | | host port |

## Decisions

### No bind mounts
The first version mounted `db/schema.sql` and `data/` from the host. On this machine Docker Desktop refused paths under
`/mnt/workspace` ("path is not shared"). Rather than depend on host file-sharing settings, the schema is baked into a
two-line MySQL image and the CSV is copied into the owner image. Side benefits: the stack runs anywhere
`docker compose up --build` works, and the dataset physically exists only in the trusted container.
**Con:** the owner image is ~95 MB bigger, and changing the CSV needs a rebuild.

### Volume ownership
Named volumes start root-owned, and the services run as `node`. The first start failed with `EACCES` writing the
signing key. Fix: create and `chown` the mount point in the Dockerfile; Docker seeds a new named volume with the image
directory's ownership. (Existing volumes from a failed run need `down -v` once.)

### Health-gated start
MySQL has a `mysqladmin ping` healthcheck; the cloud waits for `service_healthy` and then also retries its first query
for up to 40 s, because MySQL reports healthy slightly before the init script finishes on a first boot.

### `--ignore-scripts` for server installs
npm 11 warns about install scripts not covered by its allow-list (esbuild, which only the web build needs). The
server images install with `--ignore-scripts`; nothing they use needs a postinstall step.

## Development override — `docker-compose.dev.yml`

Used only with `docker compose -f docker-compose.yml -f docker-compose.dev.yml watch` (see
[DEVELOPMENT.md](DEVELOPMENT.md)):

- publishes MySQL on `${DEV_MYSQL_PORT:-3307}`, the cloud on 5000 and the owner on 4000, for tools;
- runs both APIs under `shared/dev/watch.js` and syncs `*/src` and `shared/` into the containers on change
  (Compose `develop.watch`, no bind mounts);
- runs the web container from its build stage with the Vite dev server on 5173, under its own image name
  `e-privacy-web-dev`;
- rebuilds a service when its `package.json` changes.

It publishes internal ports, so it must never be used on a server ([PRODUCTION.md](PRODUCTION.md)).
