#!/usr/bin/env bash
# Builds the web app and publishes it behind CloudFront.
#
# Hashed assets are cached for a year because their names change on every build;
# index.html is never cached, so a deploy is visible on the next page load without
# waiting for an invalidation to propagate. The invalidation is still issued, as a
# belt-and-braces for anything already holding the old index.
#
# Usage: AWS_PROFILE=gt scripts/deploy-web.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/terraform"
bucket="$(terraform output -raw web_bucket)"
distribution="$(terraform output -raw web_distribution_id)"
url="$(terraform output -raw web_url)"

cd "$root/web"
npm run build

aws s3 sync dist/ "s3://$bucket/" \
  --delete \
  --exclude index.html \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp dist/index.html "s3://$bucket/index.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8"

aws cloudfront create-invalidation \
  --distribution-id "$distribution" \
  --paths "/index.html" "/" \
  --query 'Invalidation.Id' --output text > /dev/null

echo "Published to $url"
