# Public Render demo deployment

This project can be deployed as one public Render web service with a managed
Postgres database. The web service serves the React site, REST API, and live
WebSocket from the same HTTPS URL.

## Deploy

1. Commit and push the project to the GitHub branch you want to deploy. Render
   reads the root `render.yaml` Blueprint from that branch.
2. In Render, choose **New > Blueprint**, connect the GitHub repository, and
   select that branch.
3. Review the resources and choose **Deploy Blueprint**. The first build runs
   the frontend build, applies the Alembic database migration, and starts the
   app. The public `onrender.com` URL appears on the web service page.
4. Open that URL to use the app. Visitors only need the public app link; they do
   not need GitHub.

The Blueprint is set to Render's free plans to avoid selecting billable compute
resources by default. Free web services can sleep after 15 minutes without
traffic and take about a minute to wake. Free Postgres databases expire 30 days
after creation, so this setup is suitable for a temporary demo, not durable
storage. Choose paid plans in Render if the app needs to stay warm and retain
saved fleet and mission history; check Render's current pricing before doing so.

## Public access

The public deployment is interactive. Anyone with the URL can change the shared
fleet, approvals, and mission log, and there is no login or per-user data
ownership. Use demo data only. Set `PUBLIC_READ_ONLY=true` and build with
`VITE_PUBLIC_READ_ONLY=true` if you later want to lock the public instance.
Optional OpenAI and Space-Track credentials are not needed; AI insights use the
rule-based fallback without an OpenAI key.

The Render Blueprint and its deploy flow are documented at
[Render Blueprints](https://render.com/docs/infrastructure-as-code). Render web
services provide a public `onrender.com` URL and support WebSockets
([web services](https://render.com/docs/web-services),
[WebSockets](https://render.com/docs/websocket)). See Render's
[free plan limitations](https://render.com/docs/free) before using the demo.
