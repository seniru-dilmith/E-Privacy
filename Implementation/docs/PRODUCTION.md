# Production deployment

Three ways to run E-Privacy for real, from simplest to most faithful to the design:

1. **One host, Docker**: the whole stack from `docker-compose.yml` behind a TLS reverse proxy.
2. **Two hosts, Docker**: the hospital part (owner + web) inside the hospital network, the cloud part
   (cloud + MySQL) somewhere else. This is the trust split the SRS describes.
3. **Without Docker**: Node, MySQL and nginx installed directly, services run by systemd.

Whatever you choose, read "Before going live" and "Backups" at the end. **Losing the owner's key volume makes
every campaign undecryptable.**

---

## What runs where

| Component | Listens on | Must be reachable from | Holds |
|---|---|---|---|
| web (nginx + built UI) | 80 in the container | users' browsers (through TLS) | nothing |
| owner (hospital agent) | 4000 | web only | dataset, **private keys**, receipts |
| cloud (gateway + compute) | 5000 | web and owner | signing key |
| MySQL | 3306 | cloud only | ciphertext, board, logs |

Only the web entry point is ever published to users. The owner must never be reachable from outside the hospital.

---

## 1. One host with Docker

**Server.** Linux with Docker Engine 24+ and the Compose plugin. Plan for ≥ 4 cores (encryption is CPU-bound; more cores
= faster campaigns), 4 GB RAM, and disk for ciphertext: about 13 KB per admission at 2048 bits with all 14 measures and
their squares.

**Install.**

```bash
git clone <repo-url> /opt/e-privacy
cd /opt/e-privacy/Implementation
cp .env.example .env
chmod 600 .env
```

Put strong, distinct secrets in `.env`, e.g. `openssl rand -base64 24` for each password. Then:

```dotenv
WEB_PORT=127.0.0.1:8080        # only the local reverse proxy can reach it
DEFAULT_KEY_BITS=2048
K_MIN=10
```

`WEB_PORT` is used as `"${WEB_PORT}:80"`, so an `address:port` value binds nginx to loopback only.

```bash
docker compose up -d --build
docker compose ps               # all four "running", mysql "healthy"
```

Never start `docker-compose.dev.yml` on a server: it publishes MySQL and both APIs.

**TLS in front.** Any reverse proxy works. Two settings matter: allow large request bodies (campaign uploads are
several MB per batch through the owner, and the auditor downloads all ciphertexts), and allow long requests.

Caddy (automatic HTTPS):

```caddyfile
analytics.hospital.example {
    reverse_proxy 127.0.0.1:8080 {
        transport http {
            read_timeout 15m
        }
    }
}
```

nginx on the host:

```nginx
server {
    listen 443 ssl http2;
    server_name analytics.hospital.example;
    ssl_certificate     /etc/letsencrypt/live/analytics.hospital.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.hospital.example/privkey.pem;

    client_max_body_size 64m;
    proxy_read_timeout 900s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
server { listen 80; server_name analytics.hospital.example; return 301 https://$host$request_uri; }
```

Firewall: allow 443 (and 80 for the redirect / ACME), nothing else.

**Updating.**

```bash
cd /opt/e-privacy && git pull
cd Implementation && docker compose up -d --build
```

Volumes survive rebuilds. Owner sessions are in memory, so hospital users sign in again after an update.
`db/schema.sql` is only applied to an **empty** database. A schema change on a live system needs a hand-written
`ALTER TABLE` run with `docker compose exec mysql …`, not `down -v`.

**Changing passwords.** Edit `.env`, then `docker compose up -d`. The cloud re-syncs its three accounts on start.
`CLOUD_OWNER_PASSWORD` is used by both cloud and owner, so both restart together.

---

## 2. Two hosts with Docker (hospital / cloud split)

This keeps the dataset and private keys physically inside the hospital, and the database somewhere else. It needs
two small configuration changes, because the single-host setup reaches the cloud by its Docker service name.
*This layout is described from the code but was not exercised during the project; test it before relying on it.*

```
hospital network                                 cloud provider
┌───────────────────────────┐                   ┌───────────────────────────┐
│ reverse proxy :443        │                   │ reverse proxy :443        │
│   └─ web (nginx) ─────────┼── /api/cloud ────►│   └─ cloud :5000          │
│        └─ owner :4000 ────┼── CLOUD_URL ─────►│        └─ mysql           │
└───────────────────────────┘                   └───────────────────────────┘
```

**Cloud host.** Same checkout and `.env` (only the cloud/MySQL variables matter). Publish the cloud API on loopback
for the local reverse proxy with a small override, `docker-compose.cloud-host.yml`:

```yaml
services:
  cloud:
    ports:
      - "127.0.0.1:5000:5000"
```
```bash
docker compose -f docker-compose.yml -f docker-compose.cloud-host.yml up -d --build mysql cloud
```

Put TLS in front of `127.0.0.1:5000` as `cloud.provider.example`. Restrict it to the hospital's egress IP if you can.

**Hospital host.** `.env` needs the owner variables and the same `CLOUD_OWNER_USER` / `CLOUD_OWNER_PASSWORD` as
the cloud host.

1. Point the owner at the remote cloud, `docker-compose.hospital-host.yml`:
   ```yaml
   services:
     owner:
       environment:
         CLOUD_URL: https://cloud.provider.example
   ```
2. Point the UI's cloud proxy at it too: in `web/nginx.conf`, change the `/api/cloud/` block to
   ```nginx
   location /api/cloud/ {
     proxy_pass https://cloud.provider.example/;
     proxy_ssl_server_name on;
     proxy_set_header Host cloud.provider.example;
     proxy_read_timeout 900s;
   }
   ```
3. Start only the hospital services:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.hospital-host.yml up -d --build --no-deps owner web
   ```

The owner pins the cloud's board key on its first campaign. Check that the key it pinned is the one the cloud host
reports:

```bash
docker compose exec owner cat /keys/cloud-board-key.txt     # hospital host
curl -s https://cloud.provider.example/board/key              # compare
```

Auditors and admins can use the hospital's UI, or you can run a second `web` on the cloud side for them.

---

## 3. Without Docker (systemd + nginx)

Example for Ubuntu 24.04; adjust package commands for other distributions.

**Packages.**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs mysql-server nginx
```

**Users and code.** One system user per service, so the cloud process can't read the hospital's keys or dataset:

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin eprivacy-cloud
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin eprivacy-owner
sudo git clone <repo-url> /opt/e-privacy
cd /opt/e-privacy/Implementation
sudo npm ci                     # full install; the UI build needs the dev dependencies
sudo npm run build -w web
sudo mkdir -p /var/www/e-privacy && sudo cp -r web/dist/* /var/www/e-privacy/
sudo chown root:eprivacy-owner data/hospital_admissions.csv && sudo chmod 640 data/hospital_admissions.csv
```

**Database.**

```bash
sudo mysql <<'SQL'
CREATE DATABASE eprivacy;
CREATE USER 'eprivacy'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON eprivacy.* TO 'eprivacy'@'localhost';
SQL
sudo mysql eprivacy < db/schema.sql
```

The runtime user gets data privileges only; the schema is loaded as root. `information_schema` sizes on the Monitor
page still work with these grants.

**Configuration.** `/etc/e-privacy/cloud.env` (owner `root:eprivacy-cloud`, mode 640):

```dotenv
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=eprivacy
DB_USER=eprivacy
DB_PASSWORD=a-long-random-password
K_MIN=10
SESSION_TTL_HOURS=8
CLOUD_OWNER_USER=hospital-agent
CLOUD_OWNER_PASSWORD=…
AUDITOR_USER=auditor
AUDITOR_PASSWORD=…
ADMIN_USER=admin
ADMIN_PASSWORD=…
SIGNING_KEY_FILE=/var/lib/e-privacy-cloud/signing.key
```

`/etc/e-privacy/owner.env` (owner `root:eprivacy-owner`, mode 640):

```dotenv
PORT=4000
CLOUD_URL=http://127.0.0.1:5000
CLOUD_OWNER_USER=hospital-agent
CLOUD_OWNER_PASSWORD=…
OWNER_USER=records-officer
OWNER_PASSWORD=…
DEFAULT_KEY_BITS=2048
DATASET=/opt/e-privacy/Implementation/data/hospital_admissions.csv
KEY_DIR=/var/lib/e-privacy-owner/keys
```

**systemd units.** `/etc/systemd/system/e-privacy-cloud.service`:

```ini
[Unit]
Description=E-Privacy cloud gateway
After=network.target mysql.service

[Service]
User=eprivacy-cloud
WorkingDirectory=/opt/e-privacy/Implementation/cloud
EnvironmentFile=/etc/e-privacy/cloud.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
StateDirectory=e-privacy-cloud
StateDirectoryMode=0700
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/e-privacy-owner.service` is the same with `User=eprivacy-owner`,
`WorkingDirectory=/opt/e-privacy/Implementation/owner`, `EnvironmentFile=/etc/e-privacy/owner.env`,
`StateDirectory=e-privacy-owner`, and `After=network.target e-privacy-cloud.service`. `StateDirectory` creates
`/var/lib/e-privacy-*` owned by the service user, and `ProtectSystem=strict` leaves only that writable.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now e-privacy-cloud e-privacy-owner
journalctl -u e-privacy-cloud -u e-privacy-owner -f
```

**nginx.** `/etc/nginx/sites-available/e-privacy` (then link into `sites-enabled` and run `certbot --nginx`):

```nginx
server {
    listen 80;
    server_name analytics.hospital.example;
    root /var/www/e-privacy;
    client_max_body_size 64m;

    location /api/owner/ { proxy_pass http://127.0.0.1:4000/; proxy_read_timeout 900s; }
    location /api/cloud/ { proxy_pass http://127.0.0.1:5000/; proxy_read_timeout 900s; }
    location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
    location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }
}
```

The trailing `/` on both `proxy_pass` lines matters: it strips the `/api/owner` and `/api/cloud` prefixes, as the
container setup does. Ports 4000, 5000 and 3306 stay bound to localhost (services listen on all interfaces by
default, so firewall them, or run the two-host layout).

**Updating.**

```bash
cd /opt/e-privacy && sudo git pull && cd Implementation
sudo npm ci && sudo npm run build -w web && sudo cp -r web/dist/* /var/www/e-privacy/
sudo systemctl restart e-privacy-cloud e-privacy-owner
```

---

## Before going live

- [ ] Every password in `.env` / `/etc/e-privacy/*.env` replaced, unique, and the files readable only by root and the service.
- [ ] Only 443 (and 80 for redirects) reachable from outside; MySQL, 4000 and 5000 not.
- [ ] TLS on the public entry point, and on the owner → cloud link in a two-host layout.
- [ ] `DEFAULT_KEY_BITS=2048` (or 3072). 1024 is for development only.
- [ ] `K_MIN` agreed with the data-protection officer (10 is a common small-cell threshold).
- [ ] Backups of the three stores below scheduled **and restored once** as a test.
- [ ] The fault switch on the Monitor page is off, and admins know it exists. It is logged in `query_log`.
- [ ] The board key the owner pinned matches `GET /board/key`.

## Backups

| Store | Where (Docker) | Where (systemd) | If lost |
|---|---|---|---|
| **Hospital keys** | volume `e-privacy_owner_keys` → `/keys` | `/var/lib/e-privacy-owner/keys` | **no campaign can ever be decrypted again**; receipts and pins gone |
| Cloud signing key | volume `e-privacy_cloud_keys` | `/var/lib/e-privacy-cloud/signing.key` | new key → the owner refuses results until re-pinned, and the auditor's chain check (one key per board) fails for the old entries |
| Database | volume `e-privacy_mysql_data` | MySQL datadir | ciphertext, board and logs gone; hospital can re-upload, the audit history cannot be rebuilt |

Docker examples (no bind mounts needed):

```bash
# hospital keys: copy out, then encrypt before it leaves the machine
docker compose cp owner:/keys ./owner-keys-$(date +%F)
tar czf - owner-keys-$(date +%F) | gpg --symmetric -o owner-keys-$(date +%F).tgz.gpg && rm -rf owner-keys-$(date +%F)

# cloud signing key
docker compose cp cloud:/var/lib/cloud/signing.key ./signing-$(date +%F).key

# database
docker compose exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > eprivacy-$(date +%F).sql
```

The hospital key backup contains private keys: store it encrypted, with the same care as the hospital's other key
material (SRS assumption A5), and never alongside the database backup.

**Restore** (Docker): `docker compose up -d` to create empty volumes, then
`docker compose cp ./owner-keys-DATE/. owner:/keys`,
`docker compose cp ./signing-DATE.key cloud:/var/lib/cloud/signing.key`,
`docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < eprivacy-DATE.sql`,
then fix ownership (`docker compose cp` keeps the host's user ids) and restart:
`docker compose exec -u root owner chown -R node:node /keys`,
`docker compose exec -u root cloud chown node:node /var/lib/cloud/signing.key`,
`docker compose restart cloud owner`.

## Monitoring

- `docker compose ps` / `systemctl status`: process health. All services restart on failure.
- The admin **Monitor** page: request rate, denials, errors, latency per endpoint, ciphertext storage.
- `query_log` in MySQL: every login, allow and deny, with user, role, action and timing. Keep it for audits.
- Run the auditor's "four checks" on the Bulletin board after each analysis cycle, and keep the result with the report.
