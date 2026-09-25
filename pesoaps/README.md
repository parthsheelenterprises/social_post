# PESoaps daily social posts

Cloudflare Worker for Parthsheel Enterprises. One product photo and caption per
platform per day, at **08:00 Asia/Kolkata (02:30 UTC)**. The five supplied Flipkart
links rotate in order. The deployed Cron Trigger and D1 database run in Cloudflare;
the laptop is not part of scheduled execution. GitHub stores code and can deploy
it using the included workflow.

## Current status

Deployed to PE's Cloudflare account with D1 and the 08:00 IST Cron Trigger. Meta
credentials and the verified Graph account IDs are configured. The first
scheduled post is planned for 26 September 2026. `PUBLISH_ENABLED` is `true`.
An immediate public test on 25 September 2026 published one product to both
platforms. The first scheduled post is still due on 26 September.

- Facebook destination: https://www.facebook.com/profile.php?id=61581662363686
- Instagram destination: https://www.instagram.com/parthsheelenterprises/
- The original short links are saved in `migrations/0001_initial.sql`; the full
  URLs supplied later are saved in `0002_full_product_urls.sql`.
- All five product names and photo mappings are now checked against the exact
  Flipkart product IDs and saved in `0003_verified_product_catalog.sql`.
  Evidence and local reference images are in `catalog/`. Four photos are
  1080×1080 JPEGs; the Coffee Scrub photo is an 864×1080 JPEG. Production currently
  uses the public Flipkart image URLs; its CDN must allow Meta to fetch them.
- Git repository: `parthsheelenterprises/social_post`, automation folder: `pesoaps/`.
- Cloudflare account: `1fbc90f336ed0cd8f6934c631fb732f4`, explicitly set in config.
- The repository is pushed under PE's GitHub account. The PE Cloudflare account is
  connected through a dedicated Wrangler profile. The Worker and database have been
  deployed. The Worker secret is a Page token derived from a non-expiring
  `pesocial` system-user token; neither token is in Git.
- Meta Graph Page ID: `836277059563285`; linked Instagram business account ID:
  `17841478501494423`. These were checked through the Graph API. The public
  Facebook profile URL above uses a different ID and is not the publishing ID.
- The public test posted the fifth product on
  [Facebook](https://www.facebook.com/photo/?fbid=122141663283055412) and
  [Instagram](https://www.instagram.com/p/Ddt9lzdlCJE/). The Facebook caption's
  Flipkart URL is clickable. Instagram displays the URL in the caption as plain
  text; a bio/shop link is needed for a clickable Instagram purchase path.
  Public scheduled publishing has not yet been observed.

## Publishing behavior

The Worker selects a product by Indian calendar date, stores an immutable daily
caption and image URL, then publishes a photo to Facebook and Instagram. Captions
use the verified product name, a rotating introduction, the exact Flipkart link,
and brand hashtags. They do not invent discounts, stock status, health benefits,
or product attributes. The photo is the verified product image; the current
implementation does not generate new artwork or scrape Flipkart each day.

The caption contains the purchase URL on both platforms. Instagram displays
caption URLs as plain text, so a bio/shop link is needed for a clickable purchase
path there. There is no automatic bio editing in this Worker.

Each `(day, platform)` has a unique D1 claim. Successful deliveries are never
automatically repeated. Ambiguous API failures and interrupted runs require
reconciliation with Meta before retrying, because Meta may have accepted a post
even if the response was lost. This favors avoiding duplicates over blind retries.

## Complete setup

1. Authenticate with write access to `parthsheelenterprises/social_post` and PE's
   Cloudflare account `1fbc90f336ed0cd8f6934c631fb732f4`. Run all commands below
   from the repository's `pesoaps/` directory.
2. Create D1 in the intended Cloudflare account:

   ```sh
   npx wrangler d1 create pe-soaps-social-posts
   ```

   Copy the returned database ID into the `DB` binding in `wrangler.jsonc`.
   The intended Cloudflare account ID is already configured. Apply the migrations:

   ```sh
   npx wrangler d1 migrations apply pe-soaps-social-posts --remote
   ```

3. The migrations populate all five product names and image URLs. Recheck the
   catalogue before launch, including Meta's ability to retrieve each CDN photo.
   Use a stable, publicly accessible HTTPS image of the exact product. If Meta
   cannot fetch Flipkart images, host the reference JPEGs on PE's Cloudflare
   account and update the catalogue URLs. Do not use placeholder images.
4. Connect a Meta developer app with permission to publish to this Facebook Page
   and its linked Instagram professional account. Verify the Page ID against
   Meta, obtain the numeric Instagram account ID, and confirm the app's supported
   Graph API version. Record the numeric ID and version in `wrangler.jsonc`.
   The Instagram profile handle is not the API account ID. Check current Meta
   permission requirements and token lifecycle during connection; the adapter
   has not been validated against these accounts yet.
5. Store the Page access token as a Cloudflare Worker secret, never in Git or chat:

   ```sh
   npx wrangler secret put META_PAGE_ACCESS_TOKEN
   ```

   Token expiry or revoked permissions stop publishing and appear as failed
   runs. Token renewal is not implemented; choose and document the appropriate
   Meta token lifecycle during account setup.
6. Verify all five catalogue entries and the account connection. Set
   `ROTATION_START_DATE` to the desired first posting date and enable
   `PUBLISH_ENABLED="true"` only once ready. Deploy:

   ```sh
   npm ci
   npm run check
   npm test
   npm run build
   npm run deploy
   ```

   The trigger submits the posts at 08:00 IST; Meta processing can make the
   actual visible publication time slightly later. Cloudflare trigger changes
   also need time to propagate. There is no automatic catch-up for missed days.
7. For laptop-independent future deployments, configure the GitHub
   `pesoaps-production` environment with `CLOUDFLARE_API_TOKEN` as a secret.
   The account ID is fixed to PE's account in the workflow. The scoped token needs Worker deployment
   and D1 migration permissions for this account. Run **Deploy Cloudflare** from
   GitHub Actions (workflow name: **Deploy PESoaps to Cloudflare**). Scheduled
   posting uses Cloudflare Cron, not GitHub Actions.

## Verification and operations

```sh
npm run check
npm test
npm run build
```

The test suite uses the real SQLite schema and a small D1 transport adapter, with
mocked Meta responses. It covers IST dates and cron configuration, rotation,
blocked configuration, sequential and concurrent duplicate attempts, partial
failure, and absence of a public publishing endpoint. These are not live Meta
integration tests.

For a safe local smoke test, keep publishing disabled:

```sh
npx wrangler d1 migrations apply pe-soaps-social-posts --local
npm run dev
```

Trigger the local scheduled handler at
`http://localhost:8787/__scheduled?cron=30+2+*+*+*`. The run should record
`disabled` without contacting Meta. `/health` reports HTTP service liveness,
not publishing readiness.

Inspect production runs with:

```sh
npx wrangler d1 execute pe-soaps-social-posts --remote --command "SELECT * FROM runs ORDER BY day DESC LIMIT 10"
npx wrangler d1 execute pe-soaps-social-posts --remote --command "SELECT * FROM deliveries ORDER BY day DESC LIMIT 20"
npx wrangler tail
```

Failures are recorded in D1 and structured Worker logs; failed runs throw so
Cloudflare records a failure. No email/Slack notification channel is configured.
Before any manual retry, check both platforms and reconcile interrupted delivery
rows. Do not delete claims or rerun publish calls merely because a request timed
out. To pause, set `PUBLISH_ENABLED="false"` and deploy.

## References

- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Meta Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)
- [Meta Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)

Meta's documentation endpoints returned access/rate-limit errors during initial
setup. Account connection and a live API validation remain launch prerequisites.
