# Orbital Guardian: persistence and AWS deployment runbook

**Status:** local PostgreSQL persistence is implemented in this repository. The AWS section remains a deployment plan; no AWS resources have been created by this change.

**Cost note:** this runbook describes a larger EC2 + RDS + S3 + CloudFront architecture. It is not the Free Tier deployment. For the low-service-count demo, use [DEPLOY_AWS_FREE.md](DEPLOY_AWS_FREE.md); AWS account eligibility and remaining credits still determine whether usage is covered.

This runbook turns the current local demo into a single-operator deployment with PostgreSQL persistence. It assumes the app contains demo data only. The repository currently has no authentication or authorization; put the deployment behind an IP allowlist or add application authentication before exposing decision endpoints to the public internet.

## 1. Current implementation

- FastAPI now has the original 15 orbital-analysis REST routes plus persistence routes and `/ready`; `/ws/live` remains the telemetry socket.
- PostgreSQL persistence uses SQLAlchemy 2, Psycopg, and Alembic. Docker Compose starts a local PostgreSQL container, runs migrations, then starts the API and frontend.
- Fleet configuration, current approvals, and the append-only mission log are server-owned. Live frames, orbit points, scan results, active selection, and other UI state stay transient in Zustand.
- The frontend automatically imports the old `orbital-guardian-store` values on first load. The import route is controlled by `ALLOW_LOCAL_STATE_IMPORT`; the old browser key is removed only after a successful import with no malformed approval keys. If an old approval maps to one spacecraft in the log it is scoped to that spacecraft; ambiguous or logless approvals remain visible as a legacy decision until an operator revises them.
- REST calls keep the `/api` prefix in the browser; nginx/Vite strip it before FastAPI. WebSockets now use the page's host and choose `wss` when the page uses HTTPS.

## 2. Target layout

```text
Browser (HTTPS / WSS)
        │
        ▼
CloudFront ───── default behavior ───► private S3 bucket (Vite build)
        │
        ├──── /api/* ─────────────────► EC2 nginx ─► FastAPI container ─► private RDS PostgreSQL
        └──── /ws/* ──────────────────► EC2 nginx ─► FastAPI WebSocket
```

Use S3 as a private static origin with CloudFront Origin Access Control (OAC). CloudFront serves the SPA and forwards `/api/*` and `/ws/*` to nginx on EC2. RDS is in private subnets and accepts PostgreSQL traffic only from the EC2 security group. Use an Elastic IP or stable DNS name for the EC2 custom origin.

For a portfolio demo, restrict CloudFront viewer access with an AWS WAF IP allowlist for your own IP. The app has no login today, so without that restriction anyone who can reach it can read or change the shared fleet and approvals. Do not put real operational or personal data in this single-operator version. For real users, add authentication and an `owner_id` on each persisted record before launch.

## 3. Persisted data model

Use SQLAlchemy 2.x with synchronous sessions for these CRUD routes, the `psycopg` PostgreSQL driver, and Alembic migrations. Keep each write in a database transaction. Store timestamps as timezone-aware UTC values. Normalize TCA strings to UTC before building keys.

### `fleet_members`

Persist the operator's fleet configuration, not high-frequency telemetry or derived results.

| Column | Type | Notes |
|---|---|---|
| `id` | `VARCHAR(96)` primary key | Existing slug-style ID from `makeId`; reject duplicates. |
| `name` | `VARCHAR(200)` | `tle.name`. |
| `tle_line1`, `tle_line2` | `VARCHAR(69)` | Validate through the existing Pydantic TLE schema. |
| `colour` | `VARCHAR(7)` | Hex color such as `#facc15`. |
| `active` | `BOOLEAN` | Whether the member is shown on the globe. |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | Set/update in UTC. |

On first startup, seed the existing ISS preset only when the fleet table is empty. Do not store `live_frame`, `orbit_points`, `events`, `risk_score`, or `last_scanned` in this table; those values are derived, volatile, or quickly stale.

### `approvals`

This is the current decision for a conjunction, keyed by spacecraft as well as event. The previous frontend key omitted spacecraft identity; the current action path scopes keys by `spacecraft_id`.

| Column | Type | Notes |
|---|---|---|
| `spacecraft_id` | `VARCHAR(96)` | Snapshot identifier. It intentionally has no FK so imported history/decisions can survive removal of a transient legacy fleet member. |
| `debris_name` | `VARCHAR(200)` | Event snapshot key for now. |
| `tca` | `TIMESTAMPTZ` | Canonical UTC event time. |
| `status` | `VARCHAR(16)` | Check constraint: `APPROVED` or `REJECTED`. An absent row means no active decision. |
| `decided_at` | `TIMESTAMPTZ` | UTC decision time. |
| `decided_miss_km`, `decided_score` | `DOUBLE PRECISION` | Values at decision time. |
| `notes` | `TEXT` | Optional operator note. |
| `event_miss_km`, `event_relative_velocity_kms`, `event_risk_score`, `event_risk_level` | numeric / text | Snapshot of the alert as presented to the operator. |

Use `(spacecraft_id, debris_name, tca)` as the primary key. If the backend later receives a stable NORAD ID for debris, add it to the key rather than relying on a display name.

### `mission_log`

This is the durable history, separate from the current approval state. Each approve, reject, or clear action appends a row. Do not expose a normal API that deletes or truncates this table.

| Column | Type | Notes |
|---|---|---|
| `id` | `VARCHAR(64)` primary key | Keep existing local IDs during import; use UUID strings for new rows. |
| `request_id` | `VARCHAR(36)` unique, nullable for legacy rows | UUID-formatted idempotency key so client retries do not duplicate an action. |
| `logged_at` | `TIMESTAMPTZ` | UTC server timestamp. |
| `spacecraft_id` | `VARCHAR(96)`, nullable | Snapshot reference; do not cascade-delete history with fleet members. |
| `spacecraft_name`, `debris_name` | `VARCHAR(200)` | Preserve readable names even if a fleet member is later removed. |
| `tca` | `TIMESTAMPTZ` | Event time. |
| `decision` | `VARCHAR(16)` | Check constraint: `APPROVED`, `REJECTED`, or `CLEARED`. |
| `miss_distance_km`, `risk_score`, `risk_level` | numeric / text | Alert values at the time of the decision. |
| `notes` | `TEXT` | Operator note. |
| `simulated_miss_km`, `simulated_score` | numeric | Existing post-maneuver values. |

Add indexes on `(logged_at DESC, id)` and `(spacecraft_id, logged_at DESC)`. Do not retain the current 200-row cap in the database; page the UI instead. `clearLog` should be removed or replaced with a clearly separate, admin-only retention procedure. A clear-approval action should append a `CLEARED` audit row and remove the current row from `approvals` in one transaction.

## 4. Persistence API

These are browser-facing paths. Nginx strips `/api` before sending REST requests to FastAPI, matching the existing frontend convention.

| Method and path | Behavior |
|---|---|
| `GET /api/fleet` | Return saved fleet configuration. |
| `POST /api/fleet` | Add a member from `{ "tle": {"name": "...", "line1": "...", "line2": "..."}, "colour": "#..." }`. Return `409` for an existing ID. |
| `PATCH /api/fleet/{id}` | Update allowed configuration fields such as color, active flag, or TLE. Do not accept computed telemetry fields. |
| `DELETE /api/fleet/{id}` | Remove current membership and its current approvals; preserve mission-log snapshots. |
| `GET /api/approvals?spacecraft_id=...` | Return current decisions, optionally filtered by spacecraft. |
| `PUT /api/approvals` | Upsert one decision and append one mission-log row atomically. Body contains `request_id`, `spacecraft_id`, `debris_name`, `tca`, `status`, `decided_miss_km`, `decided_score`, `notes`, and the event snapshot fields. |
| `POST /api/approvals/clear` | Body contains `request_id`, `spacecraft_id`, `spacecraft_name`, `debris_name`, and `tca`; append a `CLEARED` row and remove the active approval in one transaction. |
| `GET /api/mission-log?limit=100&offset=0` | Return newest-first pages with total count and `has_more`. |
| `POST /api/state/import-local` | Idempotently import the previous browser store. Enable only during migration, then set `ALLOW_LOCAL_STATE_IMPORT=false`. |

`PUT /api/approvals` should use one SQL transaction: upsert the `approvals` row, insert the `mission_log` action, and commit both or neither. Put a unique constraint on `mission_log.request_id` and treat a repeated request as success without inserting a duplicate. The frontend should render server responses as canonical state and show a save error if a write fails; do not silently fall back to local-only decisions.

### Frontend behavior

1. On app startup, load fleet, approvals, and the first mission-log page from the API. Keep live telemetry, orbit points, scan results, and loading/UI state in Zustand memory only.
2. Fleet add/remove/edit, approve/reject, clear approval, and log pagination call the API. Zustand updates after a successful response.
3. The old persisted key is read only for migration; server-owned state is no longer written to localStorage.
4. WebSocket URLs use the page origin: `wss` on HTTPS and `ws` otherwise, at `/ws/live`.

### One-time local data import

On first load, the frontend reads `localStorage['orbital-guardian-store']` and sends its `approvals` and `missionLog` values to `/api/state/import-local`. The import uses a persistent migration ID, preserves log IDs, and skips duplicate log IDs. It scopes an old approval to a spacecraft only when matching log entries identify exactly one spacecraft; ambiguous or logless approvals are retained under a `legacy` key and shown for the operator to revise. Malformed approval keys are reported and keep the old browser key in place for review. Once the import succeeds, the old key is removed. Keep `ALLOW_LOCAL_STATE_IMPORT=true` only for this migration window, then set it to `false`.

## 5. Run the local persistence build

1. Copy `backend/.env.example` to `backend/.env` if it does not already exist.
2. Run `docker compose up --build` from the repository root. Compose starts PostgreSQL, waits for its health check, runs `alembic upgrade head`, then starts FastAPI and the frontend.
3. Open the app in the browser that has the old localStorage state. Wait for the import to complete; if the red persistence banner reports malformed approval keys, keep the tab open and preserve the browser data for review.
4. Confirm fleet configuration and decisions remain after refresh, and that another browser sees the same server data.
5. Once the old browser data has been imported, set `ALLOW_LOCAL_STATE_IMPORT=false` in `backend/.env` and restart the backend. Keep the old import route disabled outside the migration window.

For native backend development, start the Compose database with `docker compose up -d db`, then run `alembic upgrade head` from `backend/` before starting Uvicorn. The `DATABASE_URL` in `backend/.env` points to `localhost`; Compose overrides the hostname to `db` inside its containers.

## 6. AWS console resource order

For Colorado, use `us-west-2` (US West, Oregon) as the nearby starting region. Compare the same EC2 and RDS selections in `us-east-2` (US East, Ohio) with the AWS Pricing Calculator before choosing; regional pricing varies, so proximity does not guarantee the lowest price. Keep VPC, RDS, EC2, and S3 in the chosen region. CloudFront is global. AWS Budgets sends alerts and does not enforce a hard spending limit, so a budget alert cannot guarantee a $25 cap. Avoid a NAT Gateway for this demo. Create the billable resources only if the calculator estimate is covered by credits/free-tier eligibility and you have checked the credit balance and expiration in Billing.

1. **Account and access:** enable MFA on the root account; use an IAM identity for work. Create a monthly AWS Budget alert. Use Systems Manager Session Manager for EC2 administration so the instance does not need an inbound SSH rule.
2. **VPC:** create or select a VPC with an EC2 public subnet and private database subnets in at least two Availability Zones. Create a DB subnet group from the private subnets. RDS requires the DB subnet group to span at least two AZs.
3. **Security groups:**
   - `orbital-ec2-sg`: inbound TCP 80 from the CloudFront origin-facing managed prefix list only; no public 8000 or 22. Outbound to RDS on 5432 and required package/SSM endpoints.
   - `orbital-rds-sg`: inbound TCP 5432 from `orbital-ec2-sg` only.
   - If using CloudFront as the public entry point, attach a WAF web ACL with an IP allow rule for your current public IP during this no-auth demo stage.
4. **S3 frontend bucket:** create a unique bucket, keep Block Public Access on, enable versioning and default encryption. Upload only the Vite `dist/` output. Do not configure the bucket as a public website endpoint.
5. **IAM instance profile:** allow the EC2 role Systems Manager access and read access to the one database secret. S3 reads for the static site are granted to CloudFront through OAC, not to the public or the EC2 role. Do not put AWS access keys in `.env` or the image.
6. **RDS PostgreSQL:** create the DB subnet group, choose PostgreSQL, set Public access to **No**, attach `orbital-rds-sg`, enable encryption and backups, and store the master credential in Secrets Manager. Create a separate least-privilege application DB user after initial setup; the app should not run as the master user.
7. **EC2:** allocate an Elastic IP, launch a small supported Linux instance in the public subnet, attach `orbital-ec2-sg` and the IAM instance profile, and install Docker Engine, the Compose plugin, and nginx. Configure SSM and confirm Session Manager access before closing SSH ingress.
8. **Deploy backend:** clone or copy the app to EC2 and create `backend/.env` from `backend/.env.example`. Set `DATABASE_URL` to the RDS application user's URL and set `ALLOW_LOCAL_STATE_IMPORT=false` after any required browser import. Keep credentials in Secrets Manager and write the resolved environment file with owner-only permissions. Run `docker compose -f docker-compose.aws.yml up -d --build`; this AWS-specific file does not start a local Postgres container and runs Alembic against the configured RDS URL before starting FastAPI. Bind the backend to `127.0.0.1:8000`, not `0.0.0.0:8000`. Check `docker compose -f docker-compose.aws.yml ps` and `docker compose -f docker-compose.aws.yml logs migrate backend`, then confirm `curl http://127.0.0.1:8000/ready` reports the database as ready. Do not use the regular `docker-compose.yml` on EC2: it is for local development and overrides `DATABASE_URL` to its local `db` service.
9. **Deploy frontend:** on a build machine, run `cd frontend`, `npm ci`, and `npm run build`; then sync `frontend/dist/` to the private S3 bucket with `aws s3 sync dist/ s3://YOUR_BUCKET/ --delete`. Keep the existing REST base `/api`; the current WebSocket helper already uses same-origin `wss://.../ws/live` on an HTTPS page.
10. **CloudFront:** create a standard distribution with two origins: the regional S3 bucket endpoint using OAC, and the EC2 stable DNS name as a custom origin. Set the default behavior to S3 and viewer protocol to HTTPS. Add behaviors for `/api/*` and `/ws/*` to EC2 with caching disabled. Configure SPA path fallback on the default S3 behavior (for example, a CloudFront Function that rewrites app routes to `/index.html`); keep API and WebSocket errors on their own behaviors.
11. **API behavior:** forward query strings, `Content-Type`, and `CloudFront-Forwarded-Proto`; allow `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH`, and `DELETE`. Do not cache API responses. For `/ws/*`, use HTTP/1.1 to the origin, disable caching, and use an origin request policy that forwards the WebSocket handshake headers (`Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`, and `Sec-WebSocket-Extensions`) and query strings.
12. **Access restriction and DNS:** attach the WAF IP allowlist before sharing the CloudFront URL. If using a custom viewer domain, request/validate an ACM certificate in `us-east-1`, add the alternate domain to CloudFront, and create the DNS alias. CloudFront's default hostname avoids the custom-domain certificate step.

For a real public app, add login and per-user data ownership, and configure HTTPS from CloudFront to the EC2 origin (or put an HTTPS load balancer in front of it). The minimal HTTP custom-origin setup is for a restricted demo with synthetic data only.

## 7. nginx configuration for the EC2 origin

Install this as an nginx config included inside the `http` context, for example `/etc/nginx/conf.d/orbital-guardian.conf`. The API proxy removes `/api/` so FastAPI receives its current root paths such as `/health`; `/ws/live` is preserved for FastAPI.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream orbital_backend {
    server 127.0.0.1:8000;
    keepalive 16;
}

server {
    listen 80;
    server_name _;

    location = /api {
        return 308 /api/;
    }

    location /api/ {
        proxy_pass http://orbital_backend/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_cloudfront_forwarded_proto;
        proxy_connect_timeout 10s;
        proxy_read_timeout 180s;
    }

    location /ws/ {
        proxy_pass http://orbital_backend/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / {
        return 404;
    }
}
```

Before reloading nginx, run `nginx -t`. In the backend container mapping, publish `127.0.0.1:8000:8000`; do not open port 8000 in the EC2 security group. CloudFront supports WebSockets over HTTP/1.1 and requires the handshake headers to reach the origin.

## 8. Deployment and persistence checks

- `https://<distribution>/api/health` returns 200 through CloudFront and nginx.
- The readiness endpoint reports the database connection as ready after the Alembic revision is applied.
- Add, edit, and remove a fleet member; refresh the page and confirm the configuration remains.
- Approve an event; confirm both the current approval and a mission-log row exist. Repeat the same `request_id` and confirm there is still one log row.
- Clear an approval; confirm the current approval is removed and a `CLEARED` history row remains.
- Load the same URL in a second browser and confirm the server-owned data is shared (this is expected for the single-operator deployment).
- Confirm `/ws/live` connects as `wss` from the HTTPS page and continues streaming through nginx and CloudFront.
- Confirm the S3 object URL is not public, RDS is not publicly accessible, and EC2 ports 8000/22 are not open to the internet.
- Confirm CloudFront WAF rejects a viewer IP outside the allowlist before sharing the demo.

## 9. Rollback and cleanup

For an app rollback, redeploy the previous image and frontend build; keep the RDS instance and its backups. Apply only backward-compatible migrations while older app images may still be used. To retire the demo, first take a final database snapshot and export the S3 build if desired, then delete the CloudFront distribution, EC2 instance/Elastic IP, RDS instance, S3 bucket contents, security groups, and VPC resources. Verify whether RDS final-snapshot retention and S3 versioning leave billable data behind.

## AWS references

- [Restrict access to an S3 origin with CloudFront OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Use WebSockets with CloudFront distributions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.websockets.html)
- [Create an Amazon RDS DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html)
- [CloudFront origin-facing managed prefix list](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html)
- [CloudFront custom domain certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)
