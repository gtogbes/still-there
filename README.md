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

## How it works

```
Ring webhook ──▶ normalise ──▶ occupancy filter ──▶ baseline (learned)
                                                        │
                              device health ────────────┼──▶ assess(evaluatedAt)
                                                        │         │
                                                        │         ├─▶ deviation  → notify family
                                                        │         └─▶ unobservable → notify maintenance
```

Four ideas carry most of the weight.

**Time is an argument, never ambient.** No `Date.now()` anywhere in `src/domain`.
Every function takes the instant it should reason about. That is what lets the test
suite replay ninety days in milliseconds, and what lets the demo compress a day into
twenty minutes without touching the reasoning logic.

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

## The false-positive budget

We claim this beats alert fatigue, so the claim carries a number. The suite learns a
baseline, then lives through 60 ordinary days where nothing is wrong, checks in four
times a day, and counts how often the family gets bothered for no reason.

| Household | Unnecessary alerts per 30 days | Anchors learned |
|---|---|---|
| Ese (regular routine) | **0.00** across 3 seeds | 8 |
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

The wording is generated deterministically, not by a language model. A model will
later choose tone and ordering, but it never originates a claim about what the cameras
saw. `tests/safety.test.ts` pins the invariants:

- never speculates about cause, health or injury — "no kitchen activity yet" must
  never become "she may have fallen"
- always names the habit and a clock time
- never implies footage was viewed
- `unobservable` findings are never escalated and say *cannot confirm*, rather than
  asserting nothing happened

## Running it

Requires Node 20+.

```bash
npm install
npm test          # 92 tests, no credentials or Ring account needed
npm run typecheck
npm run check     # both
```

The whole suite runs on synthetic households and fixed HMAC keys, offline, in under a
second. No AWS credentials, no Ring account, no network.

To talk to Ring, copy `.env.example` to `.env` and fill in the three credentials issued
when you register the app in the Ring Developer Portal. `.env` is gitignored. The
Client Secret and HMAC Signature Key are displayed exactly once and cannot be
retrieved afterwards, so capture them at creation time. `RING_ENVIRONMENT` defaults to
`sandbox`, which uses Ring's synthetic devices and has no rate limits — an
unconfigured deployment therefore cannot reach a real household's data.

Integration tests against the live API will sit behind a separate gated command.

## Layout

```
src/domain/       pure reasoning: no I/O, no SDKs, no ambient time
  types.ts        the vocabulary
  time.ts         local-time and DST handling via Intl
  clock.ts        injectable clocks: fixed, manual, scaled-for-demo
  stats.ts        median, MAD, quantile
  occupancy.ts    which events are evidence a person is up
  baseline.ts     learning the routine
  health.ts       could we actually have seen it?
  deviation.ts    the assessment
src/ring/         the seam with Ring. Nothing below this knows Ring exists.
  adapter.ts      Ring payloads -> ActivityEvent / DeviceHealthSample
  devices.ts      device-to-zone mapping, the one thing Ring cannot tell us
  webhook.ts      HMAC-SHA256 signature and nonce verification
src/config.ts     credential loading, with redacted logging
src/testing/      synthetic household harness
  personas.ts     Ese (regular) and Nosa (irregular)
  generator.ts    event streams, device health snapshots
  rng.ts          seeded PRNG, so measurements are comparable across runs
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

**Is a paid subscription required?** Reviewing recorded video needs a Ring plan, but
this system consumes event metadata from webhooks and builds its own rolling history,
so it may need no subscription at all. If that holds it is a real advantage worth
making explicit in the submission. Needs confirming against a live account.

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

## Not built yet

The reasoning core, the Ring seam and their tests are done. Still to come:

- Ring OAuth account linking (authorization code with PKCE) and the token exchange
- The webhook HTTP endpoint itself, server-to-server — Ring's endpoints block
  browser-initiated calls via CORS
- Real payload captures to replace the inferred fixtures in `tests/adapter.test.ts`
- Storage for the rolling event history, and idempotent ingestion so Ring's webhook
  retries do not read as extra visits to the kitchen
- AWS pipeline: EventBridge, Lambda, scheduled assessment runs
- Bedrock narration over the deterministic findings, with the safety invariants
  enforced before the model is involved
- Escalation-to-imagery boundary, logged and visible to the resident
- Family-facing notification surface and away mode UI

## Licence

MIT. See [LICENSE](LICENSE).

---

Descriptions of third-party products above were rephrased from vendor and press
sources for compliance with licensing restrictions.
