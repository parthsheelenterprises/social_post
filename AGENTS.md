# Parthsheel Enterprises social_post workspace

This checkout belongs only to Parthsheel Enterprises. Offerloom is a separate
project with separate GitHub, Cloudflare, Meta, assets, and publishing state.
Do not use Offerloom credentials, product data, or deployment targets here.

- GitHub repository: `parthsheelenterprises/social_post`. Run
  `sh scripts/setup-local-auth.sh` after cloning. Use ordinary `git` commands
  for this checkout and `sh scripts/pe-gh.sh ...` for GitHub CLI operations;
  never switch the machine-wide active GitHub account as part of PE work.
- PESoaps Worker: `pe-soaps-social-posts` in Cloudflare account
  `1fbc90f336ed0cd8f6934c631fb732f4`. Run its npm scripts from `pesoaps/`;
  local Wrangler commands must use `pesoaps/scripts/wrangler.sh`, which selects
  the `pesoaps-pe` profile. Do not use an unscoped `npx wrangler` command for PE.
- Meta app `2572580879872067`, Facebook Page Graph ID `836277059563285`,
  Instagram Graph ID `17841478501494423`. The publishing token is a Cloudflare
  Worker secret. Keep it out of the repository, command output, and chat.
- Scheduled publishing runs in Cloudflare at 08:00 IST and does not depend on
  the laptop, GitHub CLI, or browser session. Check `/health/daily` and D1
  delivery records before attributing a posting failure to local account state.
