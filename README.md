# Parthsheel Enterprises social automations

Repository: [parthsheelenterprises/social_post](https://github.com/parthsheelenterprises/social_post)

Each automation lives in its own folder, with its own code, configuration,
dependencies, tests, catalogue, and operating instructions.

| Folder | Automation | Schedule | Status |
| --- | --- | --- | --- |
| [pesoaps/](pesoaps/README.md) | PESoaps Facebook and Instagram posts with Flipkart purchase links | Daily at 08:00 IST | Deployed and enabled; daily health check at 09:00 IST |

## Repository layout

```text
social_post/
├── .github/workflows/       # GitHub requires workflow files here
│   ├── check.yml            # Checks only PESoaps changes
│   ├── deploy.yml           # Explicit PESoaps deployment
│   └── pesoaps-daily-health.yml # Checks each morning's publishing result
├── .gitignore
├── README.md
└── pesoaps/
    ├── catalog/            # Product sources, images and post previews
    ├── migrations/         # D1 catalogue and posting ledger
    ├── src/                # Cloudflare Worker and Meta API adapter
    ├── test/
    ├── package.json
    ├── package-lock.json
    ├── wrangler.jsonc
    └── README.md
```

Add future automations as sibling folders. Give each its own Cloudflare resource
names, GitHub deployment environment, workflow path filters and concurrency group.
GitHub workflow files remain at the repository root and run from the appropriate
automation directory.

## PESoaps development

This checkout uses PE-specific authentication without changing the global
GitHub CLI account used by Offerloom. Run `sh scripts/setup-local-auth.sh` once
after cloning; it configures only this checkout's `.git/config`. Git pushes then
request the `parthsheelenterprises` token from GitHub CLI, even when `offerloom`
is the active global GitHub account. For PE-specific GitHub CLI operations use
`sh scripts/pe-gh.sh <gh arguments>` (for example,
`sh scripts/pe-gh.sh workflow list`). Neither script saves a token in Git.

The `pesoaps/` npm scripts use Wrangler's `pesoaps-pe` profile locally and
ignore unrelated Cloudflare API environment variables. The protected GitHub
deployment workflow supplies a PE-only token. Cloudflare's already deployed
08:00 IST cron and Meta Worker secret are independent of local GitHub, browser,
and Wrangler login state. The daily health check reports publishing failures.

```sh
cd pesoaps
npm ci
npm run check
npm test
npm run build
```

Target Cloudflare account: `1fbc90f336ed0cd8f6934c631fb732f4`.
The account is explicitly configured in both the Worker and deployment workflow.
GitHub deployment uses the `pesoaps-production` environment and its
`CLOUDFLARE_API_TOKEN` secret. Meta credentials belong in Cloudflare Worker secrets.
Never commit credentials to this repository.

The daily schedule runs on Cloudflare after deployment and does not depend on a
laptop or a GitHub Actions scheduled job. See [PESoaps setup](pesoaps/README.md) and
[post previews](pesoaps/catalog/POST_PREVIEWS.md).
