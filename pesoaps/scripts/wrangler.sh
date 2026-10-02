#!/bin/sh
set -eu

# CI gets its own PE token from the protected GitHub environment. Local commands
# explicitly use the PE Wrangler profile, ignoring unrelated Offerloom env vars.
if [ -n "${PE_SOAPS_CLOUDFLARE_API_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN="$PE_SOAPS_CLOUDFLARE_API_TOKEN"
  export CLOUDFLARE_ACCOUNT_ID=1fbc90f336ed0cd8f6934c631fb732f4
  exec ./node_modules/.bin/wrangler "$@"
fi

unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
exec ./node_modules/.bin/wrangler --profile pesoaps-pe "$@"
