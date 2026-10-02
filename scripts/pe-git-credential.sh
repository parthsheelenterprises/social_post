#!/bin/sh
# Git invokes this helper only for the PE repository. Never print the token to
# logs; return it through Git's credential protocol on stdout.
[ "${1:-}" = get ] || exit 0

protocol=
host=
path=
while IFS='=' read -r key value; do
  [ -n "$key" ] || break
  case "$key" in
    protocol) protocol=$value ;;
    host) host=$value ;;
    path) path=$value ;;
  esac
done

[ "$protocol" = https ] || exit 0
[ "$host" = github.com ] || exit 0
[ "$path" = parthsheelenterprises/social_post.git ] || exit 0

unset GH_TOKEN GITHUB_TOKEN
token=$(gh auth token --hostname github.com --user parthsheelenterprises) || exit 1
printf 'username=parthsheelenterprises\npassword=%s\n' "$token"
