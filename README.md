# StillThere

Absence-based caretaking for Ring devices. It learns a household's daily rhythm and
alerts on the activity that **didn't** happen.

Built for the Ring track of the Build, Ship, Shape: Amazon Developer Hackathon.

## The idea

A Ring doorbell already records the shape of someone's day — door opened at 08:10,
motion in the hallway, movement in the kitchen. Normally those events exist to tell
you a stranger is outside. StillThere uses them backwards.

It spends a couple of weeks learning that Ese, 82, is up before eight, out for the
paper by ten past, and in the kitchen by half past. Then one Tuesday none of that
happens, and her daughter gets a message at work: *no sign of activity yet today,
usually by 08:21, it's now 11:30.* Not an alarm. A nudge, with its reasoning attached.

No live feed to watch, no footage reviewed by default, and no professionally installed
sensor kit — it runs on Ring hardware people already own.

## Honest positioning: this category exists

Worth stating plainly, because it shapes what is actually new here.

- **Alarm.com Wellness** does essentially this today, commercially: machine learning
  over activity data to learn routines and alert family to changes that suggest a
  problem. It needs a professionally fitted sensor kit, a panel, a dealer and a
  monitoring subscription.
- **Amazon built and then withdrew it.** Alexa Care Hub (2020) became the Alexa
  Together subscription, which was discontinued in May 2025 and replaced by Alexa
  Emergency Assist — a *reactive* service where someone has to ask for help.
- There is twenty years of academic work on activity-of-daily-living anomaly
  detection behind both.

So the concept is not novel. Four things about this delivery are:

1. **Zero new hardware.** Ring's installed base is tens of millions of devices
   already mounted and powered. No installer, no contract, no panel.
2. **It fills a gap Amazon left.** Passive routine monitoring is precisely what
   Emergency Assist cannot do, because the whole point is the days nobody can ask.
3. **It was impossible on Ring until recently.** The Ring developer APIs only reached
   general availability in April 2026; every prior integration ran on unofficial
   reverse-engineered libraries.
4. **The alert explains itself.** Traditional systems cross a threshold and emit
   "unusual activity detected", families stop trusting those, and then stop reading
   them. Every finding here names the specific habit, the time it was expected, and
   how consistent that habit has been.

## What is real and what is simulated

Stated up front, because it is the first thing anyone evaluating this should know, and
better said by us than discovered by a reviewer.

**No Ring account has ever been linked to this app, and no physical Ring device was
used.** Not a shortcut we took for convenience — Ring private apps connect real
accounts, up to five, and [each connected account needs an active Ring Protect Plan or
trial](https://developer.amazon.com/docs/ring/developer-faq.html) for device access.
We had neither the hardware nor the subscription.

So the events are ours. `scripts/send-test-webhook.mjs` builds a payload in Ring's
documented webhook v1.1 shape, signs it with the real HMAC key issued by the Ring
Developer Portal, and posts it at the deployed endpoint over the public internet.

What that genuinely exercises, on real infrastructure:

| Exercised for real | How |
|---|---|
| HMAC-SHA256 signature verification | Valid signature accepted, tampered body rejected with 401 |
| The v1.1 JSON:API envelope | Parsed from `data.type`, `data.attributes.source`, `data.attributes.timestamp` |
| Ring's event vocabulary | `motion_detected`, `button_press`, `contact_sensor_faulted`, `device_offline`, `app_integration_removed` |
| Deduplication | Replayed `meta.request_id` returns `duplicate` |
| Everything downstream | Storage, baseline learning, assessment, Bedrock narration, SNS delivery, erasure |
| Client credentials | Verified against `oauth.ring.com`, which returns `invalid_grant` rather than `invalid_client` |

**The one untested assumption is that Ring's actual bytes match its documented shape.**
Everything downstream of the parser is proven; the parser itself is written from the
specification rather than from a captured delivery. This is exactly why the adapter is
strict rather than tolerant: an unrecognised payload returns `invalid` listing the keys
it did contain, so the first real delivery reports precisely what differs instead of
silently coercing something plausible. An earlier version guessed a flat payload shape
and was wrong about nearly every field name, which is how that lesson was learned.

Ring's Playground was useful for reading real API responses, but as far as we could
determine it does not deliver events to a registered webhook URL, so it could not
stand in as an event source.

## How it works

```
Ring webhook ──▶ verify HMAC ──▶ classify ──▶ dedupe ──▶ DynamoDB
                                     │
                                     ├─ activity      → event stream
                                     ├─ device status → latest health per device
                                     └─ revocation    → erase everything

every 15 min ──▶ learn baseline (42 days, excluding today)
                        │
                        ├─ assess(evaluatedAt) ──┬─ deviation     → Bedrock → validate → SNS
                        │                        └─ unobservable  → maintenance, never family
                        └─ device health
```

Four ideas carry most of the weight.

**Time is an argument, never ambient.** No `Date.now()` anywhere in `src/domain`.
Every function takes the instant it should reason about.

That one constraint pays for itself repeatedly. It is why the test suite replays ninety
days in under a second, why the false-positive budget is measurable at all, and why both
demos can walk through a morning without waiting for one. A system that reads the clock
internally could not be demonstrated in three minutes, which for a project judged on a
three-minute video would have been fatal.

**Not all events are occupancy evidence.** A doorbell facing the street fires on
passing cars and the postman. If exterior motion counted as occupancy the system would
report a normal morning for a house nobody had got out of bed in — the most dangerous
false negative available. Only interior movement, or a door physically opening, counts.

**And not all interior movement is a person.** Ring classifies motion as `human`,
`vehicle` or `other_motion`, and that distinction does real work here, because the cat
walks through the hallway all day. By default only `human` and unclassified motion count
as proof of life. The asymmetry is deliberate: mistaking a pet for the resident means
silence on a day something was wrong, while discounting the resident means one
unnecessary phone call. Only one of those hurts anybody, so the conservative reading
wins even though it costs us false positives.

A pleasant consequence, found while writing the test for it: a cat cannot open a front
door, so the contact-sensor anchor survives even if motion classification fails
completely. Households with a contact sensor get defence in depth for free, which is
useful when advising someone which device to add first.

**A flat battery and an unconscious person produce identical data: silence.** Every
missing-activity finding is checked against device health first. If the camera was
offline, flat, or quietly stale, the finding becomes `unobservable` and routes to
maintenance — never to the family as a welfare alert. This is the single correctness
question in the product.

**Deadlines come from the late edge of what this household actually does.** The 95th
percentile of observed times, plus a grace period, rather than a median and a spread
multiplier. Most mornings cluster tightly and then straggle, so a symmetric model
gives a regular household a hair-trigger and an irregular one a deadline that never
arrives.

**Withdrawing consent erases everything.** When Ring reports that someone removed the
integration, the tokens, activity history, learned routine, room assignments and record
of past notifications are all deleted. Not marked for expiry — deleted. Letting the
90-day TTL handle it would be defensible and would also mean keeping months of
somebody's movements after they asked us to stop. Expiry is not erasure.

## The false-positive budget

We claim this beats alert fatigue, so the claim carries a number. The suite learns a
baseline, then lives through 60 ordinary days where nothing is wrong, checks in four
times a day, and counts how often the family gets bothered for no reason.

| Household | Unnecessary alerts per 30 days | Anchors learned |
|---|---|---|
| Ese (regular routine, and a cat) | **0.00** across 3 seeds | 8 |
| Nosa (no real schedule) | **1.00, 1.00, 1.50** across 3 seeds | 4 |

Nosa's budget is deliberately non-zero, and he is the honest half of the test. His
habits are loose enough that some days genuinely look like nothing happened. The two
cheap ways to make his number zero are to invent structure he does not have, or to
widen tolerances until nothing is ever noticed — so there is a test asserting he still
has anchors, to prove the budget is met by judgement rather than by giving up.

The reliability threshold is what does the work. An anchor absent on 12% of normal
days will fire on 12% of normal days, which is about three nudges a month for a habit
the resident simply does not always keep. At 0.95 a habit must hold on more than
nineteen days in twenty before we are willing to wake anybody over its absence. For
Nosa that means all his mealtime anchors are correctly discarded: the system can tell
you reliably whether he reached his lounge, and admits it knows nothing dependable
about when he eats.

## What an alert is allowed to say

Findings are generated deterministically. Bedrock then rewrites them into something
readable, and **its output is a proposal, not a decision.**

That distinction is the whole design. A language model cannot be tested into never
saying "she may have fallen" — prompting lowers the odds and guarantees nothing. So
the model's text is checked against the same rules the deterministic text already
satisfies, and discarded in favour of that text when it fails. The safety properties
therefore hold regardless of the model, the prompt, or a bad day.

`tests/safety.test.ts` and `tests/narration.test.ts` pin the invariants. Rejected:

- speculation about cause, health or injury — "no kitchen activity yet" must never
  become "she may have fallen"
- any claim that footage was viewed
- a message with no clock time, which has degraded into "something seems off"
- a reference to a habit we never assessed — a model inventing a bathroom reads
  entirely plausible, which is what makes it dangerous
- anything over 600 characters

`unobservable` findings are never escalated and never reach the family at all. A camera
that stopped reporting is a maintenance job, and routing it alongside genuine welfare
nudges is how the whole channel gets muted.

The model never decides *whether* to alert, and never sees an image.

Four verified findings become:

> No sign of Ese being up yet today — usually by 08:28, and it's now 12:26. The
> hallway, front door, and kitchen are also quiet.

And when Bedrock is unavailable, denied, or says something unacceptable, this goes
instead — verified by pointing the deployment at a nonexistent model:

> No first sign of activity yet today. Usually by 07:31 (allowing until 08:28), seen on
> 30 of the last 30 working days. It is now 12:26, 238 minutes past. 3 other usual
> activities are also outstanding.

Narration degrades. It does not fail, and it never blocks a notification.

## Running it

Requires Node 20+.

```bash
npm install
npm run demo      # watch the whole thing work, offline, in about a second
npm test          # 124 tests
npm run check     # typecheck + tests
```

**Start with `npm run demo`.** It needs no AWS account, no Ring account and no
credentials. It learns Ese's routine from 42 days of history, shows an ordinary day
producing silence, then walks a bad day from 08:00 (nothing overdue yet) through to
12:26, and finishes on the two things that were easy to get wrong — the cat, and a
camera that had stopped watching.

The test suite is the same: synthetic households and fixed HMAC keys, offline, under a
second, no network.

### Talking to Ring

Copy `.env.example` to `.env` and fill in the three credentials issued when you
register the app in the Ring Developer Portal. `.env` is gitignored.

The Client Secret and HMAC Signature Key are shown exactly once and cannot be
retrieved afterwards. If you lose them the only remedy before certification is deleting
the app and creating a new one.

```bash
npm run check:creds        # validates .env shape without printing any of it
npm run check:creds:live   # asks Ring whether the credentials are real
```

The live check works by presenting a deliberately invalid authorisation code. Ring
distinguishes `invalid_client` from `invalid_grant`, so **`invalid_grant` is the pass
condition** — the client authenticated and only the fake code was rejected.

### Deploying and demonstrating

See [terraform/README.md](terraform/README.md) for the deploy sequence. Then:

```bash
AWS_PROFILE=… node dist/tools/seed-household.mjs --history 42 --break-today
npm run demo:live -- --api https://<id>.execute-api.us-east-1.amazonaws.com
```

`demo:live` drives the deployed stack: a signed webhook crosses the internet, a
tampered one is refused, the assessment is asked about three times of day, Bedrock
phrases the result, and finally the integration is removed and every stored row is
erased.

Both demos compress time by *asking the assessment about a chosen moment* rather than
waiting for it. Nothing is faked — events carry real timestamps, and this is possible
only because no code in `src/domain` reads the clock.

## Layout

```
src/domain/       pure reasoning: no I/O, no SDKs, no ambient time
  types.ts        the vocabulary
  time.ts         local-time and DST handling via Intl
  clock.ts        injectable clocks: fixed, manual, scaled
  stats.ts        median, MAD, quantile
  occupancy.ts    which events are evidence a person is up
  baseline.ts     learning the routine
  health.ts       could we actually have seen it?
  deviation.ts    the assessment
src/ring/         the seam with Ring. Nothing below this knows Ring exists.
  adapter.ts      Ring payloads -> ActivityEvent / DeviceHealthSample
  classify.ts     what kind of message is this? pure, and separately tested
  devices.ts      device-to-zone mapping, the one thing Ring cannot tell us
  webhook.ts      HMAC-SHA256 signature and nonce verification
src/narration/    the Bedrock layer
  prompt.ts       facts and a writing job, never a judgement
  validate.ts     the gate: what a model is allowed to have written
  narrate.ts      calls Bedrock, validates, falls back. Never throws.
src/notify/       SNS delivery
src/storage/      DynamoDB access
  events.ts       activity history, paginated
  state.ts        tokens, device map, health, dedup
  household.ts    per-household configuration
  assessments.ts  the audit trail for why a family was contacted
  erase.ts        honouring a withdrawal of consent
src/handlers/     Lambda entry points
  webhook.ts      verify, classify, record, acknowledge inside 5s
  token.ts        Ring's authorisation code -> tokens (form-encoded, not JSON)
  link.ts         account link landing, nonce freshness
  assess.ts       the scheduled assessment
  home.ts         public landing page. No data access at all.
src/testing/      synthetic household harness
  personas.ts     Ese (regular) and Nosa (irregular, with a cat)
  generator.ts    event streams, device health snapshots
  rng.ts          seeded PRNG, so measurements are comparable across runs
scripts/          operator tools
  demo-local.mjs      offline demonstration
  demo-live.mjs       drives the deployed stack
  seed-household.mjs  synthetic history into DynamoDB
  check-credentials.mjs / push-secret.mjs / audit-exposure.mjs
terraform/        the deployment
tests/
```

### Zone is our concept, not Ring's

Ring knows a device with a given ID saw motion. It has no idea that device is in a
hallway, and no idea a hallway is indoors. That mapping is supplied by whoever sets the
household up, and the interior/exterior distinction the entire occupancy model rests on
derives from it.

Which makes it quietly dangerous. Label the front-door camera as a hallway and passing
traffic starts counting as proof the resident is awake — no error, no warning, just a
system that has stopped working. Unmapped devices are surfaced rather than guessed at,
and an event from a device with no zone is declined instead of being placed somewhere
plausible.

## Known unknowns

Recorded honestly, because these decide whether the design survives contact with the
real API.

**Resolved: `door_open` is real, but it belongs to sensors.** The scope picker in the
Ring Developer Portal settles it — Cameras and Doorbells covers motion, doorbell
presses, livestream and video download, while Contact Sensors covers door and window
open/close. So the occupancy model was not wrong, it was assuming hardware we had not
accounted for. Both scopes are requested. In production a household needs a contact
sensor for the strongest signal; without one the model falls back to interior motion,
which still works.

**Resolved: device online/offline comes free.** Every approved app automatically
receives Account and Lifecycle events, including device status changes. The blind-spot
detection that the whole design leans on now has a real feed behind it rather than a
hopeful interface.

**A doorbell alone is not enough.** Under our own model, a doorbell facing the street
produces exterior motion, which is explicitly *not* occupancy evidence. Absence
detection needs at least one interior zone, so the cheap plug-in Indoor Camera is the
load-bearing device here and the doorbell is the optional extra. Worth stating plainly
rather than letting the "runs on hardware you already own" line do more work than it
has earned.

**Resolved, unfavourably: a subscription is required.** An earlier draft of this file
guessed that consuming event metadata rather than video might avoid needing a Ring
plan. It does not. Ring's FAQ states that each account connected to a private app needs
an active Ring Protect Plan or trial for device access. Worth recording because the
guess was wrong and the correction matters: there is no free path to real Ring data.

**Resolved: there is no synthetic-device sandbox we can point this at.** Another wrong
guess, based on a single line in the Getting Started FAQ. Private apps go Configure →
Build → **Connect**, and Connect means authorising a real Ring account. The Playground
is a browser tool for trying API calls, not an event source for a registered webhook.
This is why the events in this project are ours — see *What is real and what is
simulated* above.

**Resolved: the payload is a JSON:API envelope.** Field paths now follow Ring's webhook
v1.1 specification — `data.type`, `data.attributes.source`,
`data.attributes.timestamp`, with `meta.request_id` as the deduplication key. An earlier
version of the adapter guessed a flat shape and was wrong about nearly every name,
which is a reasonable argument for reading the specification first. Two vocabularies
exist and are handled separately: webhooks say `motion_detected` and `button_press`,
the Event History API says `motion` and `ding`.

Still outstanding: these are documented shapes, not captured ones. Replacing the
fixtures with live sandbox deliveries remains the first job. The adapter stays strict
rather than tolerant for exactly that reason — an unrecognised payload reports the keys
it actually contained, so one failed delivery tells us what moved.

**Link the Ring account as early as possible.** The Event History API is time-gated to
the consent date and cannot reach back before it. Ring accumulates history from linking
onward, which means our pipeline does not have to be up continuously to build a
baseline — but every day of delay is a day of history that can never be recovered.
Sensors are the exception: no history endpoint covers them at all, so contact-sensor
events must be persisted on receipt or lost.

**No video access without motion access.** The Cameras and Doorbells scope bundles
livestream and video download with motion events; they cannot be requested separately.
So the application holds video capability it deliberately does not exercise. Worth
stating plainly rather than letting the privacy claim imply we could not look if we
wanted to. Scopes we genuinely do not need — flood, temperature, air quality, chimes —
are all switched off.

## Deployed and working

Running in `us-east-1`: an HTTP API with four routes, five arm64 Lambdas with a role
each, two DynamoDB tables, a customer-managed KMS key, Secrets Manager, EventBridge
Scheduler on a 15-minute cycle, and four alarms. Around £1.50/month, nearly all of it
the KMS key.

Verified against the live stack: signature verification and rejection, the full event
vocabulary, deduplication, baseline learning over 2,000 stored events, assessment at
chosen times, Bedrock narration with fallback, SNS delivery, and erasure of 2,041 rows
on withdrawal of consent.

## Not built yet

- **Token refresh.** Access tokens last ~4 hours and refresh tokens ~30 days. An
  expired refresh token cannot be recovered — the user must re-link, which resets the
  consent date and therefore discards the accumulated baseline. This needs a scheduled
  job before any real account is connected.
- **Completing the account link.** `token.ts` stores tokens unclaimed and `link.ts`
  records a pending nonce; nothing yet joins the two. That needs a sign-in step.
- **A sign-in surface.** The landing page currently says so plainly rather than
  offering a link that goes nowhere.
- **Device discovery.** Zone mapping is seeded by script. A real setup flow would list
  an account's devices and let someone say which room each is in.
- **Event History backfill**, to pull activity Ring already recorded since consent.
- **Escalation to imagery** — fetching one frame when a high-severity finding trips,
  logged and visible to the resident. The boundary is designed; the call is not wired.
- **Away mode.** Suppression windows exist in the data model with no way to set them.
- **Real payload captures** to replace the documented-shape fixtures in
  `tests/adapter.test.ts`.
- `checkov` / `tfsec` have not been run against the Terraform.

## Licence

MIT. See [LICENSE](LICENSE).

---

Descriptions of third-party products above were rephrased from vendor and press
sources for compliance with licensing restrictions.
