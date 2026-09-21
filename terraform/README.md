# Deploying StillThere

Three Lambda functions behind an HTTP API, two DynamoDB tables, one KMS key and one
secret. Region is `us-east-1`. Cost at this scale is a few pence a month — everything
is pay-per-request and idle costs nothing.

## Order of operations

The sequence matters. The Ring portal needs URLs that do not exist until after the
first apply, and the secret must be populated before any account is linked.

```bash
# 1. Bundle the handlers. Terraform zips from dist/, so this comes first.
cd .. && npm run build:lambda && cd terraform

# 2. Configure
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars          # set owner at minimum

# 3. Review, then apply
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# 4. Put the real credentials in Secrets Manager. Terraform created the secret
#    with placeholders and will never overwrite it, so these stay out of state.
terraform output populate_secret_command     # prints the command to adapt

# 5. Take the three URLs to the Ring Developer Portal → Account linking
terraform output account_link_url
terraform output token_exchange_url
terraform output webhook_url
```

## Why it is built this way

**A role per function.** Three near-identical IAM policies rather than one shared
role, so the webhook cannot read OAuth tokens and the token exchange cannot write to
the event stream. Cheap insurance on a blast radius.

**Credentials by reference, never by value.** Lambda environment variables carry the
secret's ARN. The values themselves live in Secrets Manager because environment
variables surface in the console, in `aws lambda get-function` output, and in
whatever shell history the last person left behind. The secret's `secret_string` is
under `ignore_changes`, which is what keeps credentials out of `terraform.tfstate`.

**Two tables, not one.** Events are append-only, time-partitioned and expire after
ninety days. State holds tokens, device mappings, device health and deduplication
markers, and must not expire. Sharing a TTL attribute between those two is a good way
to delete somebody's refresh token at three in the morning.

**A customer-managed KMS key.** This stack stores a movement log of somebody's home
plus their OAuth refresh tokens. A CMK is what makes rotation and access auditing
possible later; the AWS-managed default forecloses both.

**Graviton.** `arm64` on all three functions. Same source, lower cost per
millisecond.

## The unauthenticated endpoints

No API Gateway authoriser on any route, deliberately. Each endpoint authenticates in
a way that conventional API auth cannot express:

| Route | How it authenticates |
|---|---|
| `POST /ring/webhook` | Ring signs the body; the handler verifies HMAC-SHA256 from `X-Signature` and returns 401 otherwise. We do not control what Ring sends, so an IAM or JWT authoriser is not an option. |
| `POST /ring/token` | Ring calls this server-to-server with a single-use authorisation code valid for sixty seconds. The code is the credential and is worthless without our client secret. |
| `GET /ring/link` | A user's browser arrives with a Ring-issued nonce that expires in ten minutes. Public by necessity — it is the beginning of authentication, so it cannot require it. |

What remains is unauthenticated *invocation*: anyone who finds the URLs can make the
functions run, and rejected requests cost a fraction of a penny. Stage throttling caps
that at 10 requests per second, and every handler rejects before doing real work.

## Alarms

Two, both on symptoms rather than causes, and both only wired up if you set
`alarm_email`.

Rejected signatures are worth knowing about because there are only two explanations:
our HMAC key is wrong and every event is being silently dropped, or somebody is
probing the endpoint.

Handler errors matter because the failure mode of this product is silence, and
silence is indistinguishable from a quiet house. A webhook handler that is failing
looks exactly like nothing happening.

## Not yet here

- Scheduled assessment runs (EventBridge Scheduler → an assess function)
- Token refresh. Access tokens last about four hours and refresh tokens about thirty
  days; an expired refresh token cannot be recovered and forces the user to link
  again, so this needs a scheduled job well before it needs a UI.
- Event History backfill, to pull activity Ring has already recorded
- Bedrock narration and the notification surface
- Remote state. The `backend "s3"` block in `versions.tf` is commented out so a
  first apply works from a clean checkout. Local state is acceptable for one
  operator and a liability the moment it is not.

## Security scanning

Your standards call for `checkov` or `tfsec` in CI. Neither is installed on this
machine, so neither has been run against this configuration — worth doing before
this is treated as reviewed:

```bash
brew install checkov && checkov -d .
```
