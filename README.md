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

No indoor cameras. No live feed to watch. No new hardware — it runs on the doorbell
already screwed to the wall.

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
passing cars, the postman, next door's cat. If exterior motion counted as occupancy
the system would report a normal morning for a house nobody had got out of bed in —
the most dangerous false negative available. Only interior movement, or a door
physically opening, counts.

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
npm test          # 41 tests, no credentials or Ring account needed
npm run typecheck
npm run check     # both
```

The whole suite runs on synthetic households, offline, in under a second. No AWS
credentials, no Ring account, no network. Integration tests against the real Ring API
will sit behind a separate gated command.

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
src/testing/      synthetic household harness
  personas.ts     Ese (regular) and Nosa (irregular)
  generator.ts    event streams, device health snapshots
  rng.ts          seeded PRNG, so measurements are comparable across runs
tests/
```

## Not built yet

This is the reasoning core and its test harness. Still to come:

- Ring OAuth (PKCE) and webhook ingestion, server-to-server — Ring's endpoints block
  browser-initiated calls via CORS
- Contract tests asserting the synthetic event shape matches real Ring payloads
- AWS pipeline: EventBridge, Lambda, storage for the rolling event history
- Bedrock narration over the deterministic findings, with the safety invariants
  enforced before the model is involved
- Escalation-to-imagery boundary, logged and visible to the resident
- Family-facing notification surface and away mode UI

## Licence

MIT. See [LICENSE](LICENSE).

---

Descriptions of third-party products above were rephrased from vendor and press
sources for compliance with licensing restrictions.
