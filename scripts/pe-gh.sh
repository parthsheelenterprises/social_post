#!/bin/sh
# Run GitHub CLI as PE for this command only, without changing gh's active user.
unset GH_TOKEN GITHUB_TOKEN
token=$(gh auth token --hostname github.com --user parthsheelenterprises) || exit 1
GH_TOKEN=$token exec gh "$@"
