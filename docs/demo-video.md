# Demo video: script and recording guide

Under three minutes. Judges may stop at 3:00, so the story has to land early.

---

## Part 1: what this video has to achieve

Four things, in this order of importance.

1. **Make someone feel the problem inside twenty seconds.** Not "monitoring for
   the elderly". The specific dread: you have a camera at your mum's door, it tells you
   when something happens, and the day you are frightened of is the day nothing does.
2. **Show the product working, with cause and effect.** The viewer has to see time move,
   see nothing happen, and see the family get told. If they cannot tell what caused what,
   the demo has failed.
3. **Show the one thing nothing else does: it explains itself.** Ask it why it got in
   touch and it answers from the record. This is the part a judge remembers.
4. **Prove it is real.** A live MCP server on AWS, five tools, Bedrock choosing between
   them, its own screen for an Echo Show.

## The story, in one paragraph

A camera tells you when something happens. Nobody sells you the opposite. StillThere
spends a fortnight learning one person's ordinary day, then watches for the day that
does not happen: no one up, no kettle, no front door. When a habit is later than that
person's own normal range it sends the family one short message, and if the morning gets
worse it says so again, at most three times. Then, because it stored what it sent and
why, the family can ask it out loud and get the actual reasoning back.

## The shape of the recording

Three acts, with a turn in the middle.

| Act | Running time | What the viewer takes away |
|---|---|---|
| The dread, and the quiet default | 0:00 to 0:40 | Most days it says nothing. That is deliberate. |
| The morning that did not happen | 0:40 to 2:10 | One nudge, then only on escalation, and it explains itself. |
| What is underneath, and what is honest | 2:10 to 2:50 | A real MCP server, and a clear account of what is simulated. |

Your narration is about 400 words, which is roughly two minutes and forty seconds at a
calm pace. The device also speaks for about thirty seconds. Some of that overlaps, since
you talk over the playback, so expect a first take between 2:50 and 3:10.

**Time a dry run before you record.** If you are over three minutes, cut in this order
and stop as soon as you are under:

1. The "That is all she gets" aside after the messages land. The phone is already on
    screen, so the point is made visually.
2. The second paragraph of **Underneath**, from "The model only picks the tool". Keep the
    first paragraph, which is the part that proves the track requirement.
3. The "She's away" beat. Losing it costs you a point the judging guidance rewards
    (state held across a conversation), so cut it last.

Do not cut the play sequence or the "ask it why" beat. Those two are the demo.

---

## Part 2: before you record

Record in **two passes**. It is far easier than talking and clicking at once:

1. **Pass one, picture only.** Click through the whole thing in silence. Do it twice and
   keep the better take.
2. **Pass two, voice over the picture.** Read the narration while watching your own
   recording. Re-record just the audio if you fluff a line.

If you would rather do it live, that is fine, but rehearse the clicks once first.

### Checklist

- [ ] **Open https://stillthere.ogbes.com in Chrome.** Not the `.cloudfront.net` address.
      The URL is on screen the whole time.
- [ ] **Enter the access code before you start recording.** It is remembered for the tab.
- [ ] **Check today's demo data is there.** Drag the clock to 12:30 and confirm the phone
      on the right shows three messages. If it shows none, the nightly reset did not run:
      `AWS_PROFILE=gt aws lambda invoke --function-name still-there-dev-demo-reset /tmp/r.json`
      then reload. Put the clock back to 08:00 before recording.
- [ ] **Window about 1500 x 1000**, zoom 100%, bookmarks bar hidden, one tab only.
- [ ] **Spoken replies on** (top right). The device talking is half the effect.
- [ ] **Click the microphone once before recording** so Chrome's permission prompt is out
      of the way.
- [ ] Do Not Disturb on. Quit Slack and Mail.
- [ ] **Capture system audio**, or the spoken replies will be silent. macOS's Cmd+Shift+5
      records the microphone only. Use **OBS** with a *macOS Screen Capture* source with
      audio enabled, plus your microphone as a second source.
- [ ] For the terminal shot, have the MCP Inspector output **already on screen** with the
      command scrolled out of view. The command contains the access code.
- [ ] Reload the page so the clock is back at 08:00 and no answer card is showing.

### One thing that will trip you up

**Do not read the exact times aloud.** Jasmine's routine is relearned every night from
generated history, so "usually by 07:32" might be 07:35 tomorrow. Say "about half seven"
and you can record on any day. The script below never states a precise minute.

---

## Part 3: the opening, in detail

You asked what you are actually doing here. The answer is: **almost nothing.** The
opening is a still screen and your voice. Resist the urge to click.

**What is on your screen when you press record**

- Browser at `stillthere.ogbes.com`, address bar visible.
- The dark Echo Show fills most of the window. Top left reads "Wednesday · 08:00".
- The headline says *Nothing out of the ordinary so far today.*
- Under it, four habits as rows: Up and about, Hallway, Front door, Kitchen. Each has a
  hollow ring at its usual time. A cyan **NOW 08:00** line sits to the left of them.
- Right-hand side: a phone showing 08:00 and **No notifications**, and the demo clock
  with 08:00 highlighted.

**What you do**

| Time | Your hands | What you say |
|---|---|---|
| 0:00 to 0:07 | Nothing. Let the still screen sit there. | "My mum is eighty-two and lives alone. I have a camera at her front door." |
| 0:07 to 0:15 | Nothing. | "It tells me when something happens. A delivery, a car going past. The day I dread is the one where nothing happens at all, and no camera tells you that." |
| 0:15 to 0:18 | Move the cursor slowly along the four habit rows. Do not click. | "This is StillThere." |

That is the whole opening: two sentences of problem, one of product, over a static
screen. The cursor movement at 0:16 is only there to point the viewer at the four rows
before you explain them.

---

## Part 4: the full script

**SAY** is your narration. **DO** is your hands. **SCREEN** is what the viewer sees.

### 0:00 to 0:18 · The dread

As set out in Part 3. Still screen, no clicking.

### 0:18 to 0:40 · What it learned, and why it is quiet

**DO:** nothing yet. Let the timeline hold.

**SAY:** "Over a fortnight it learned her ordinary day. Up by about half seven, out of
the front door, in the kitchen by quarter past eight."

**SAY:** "It is eight now, and she is already a little late. But still inside her own
normal range, so it says nothing. An alert you get every day is one you stop reading."

> Why this beat matters: it sets up the quiet default, so the message landing later
> actually means something. Skip this and the demo is just notifications appearing.

### 0:40 to 1:18 · Press play and let the morning fail

**DO:** click the round **play** button on the demo clock, bottom right. Then take your
hand off the mouse.

**SCREEN:** the clock runs from 08:00 to 13:00 in about fifteen seconds. The NOW line
slides right across the four rows. The rows turn amber as each habit goes past its
normal range. Three messages drop onto the phone, at roughly three, eight and fourteen
seconds in.

**SAY, as it starts:** "So let the morning run. Nobody has got up. No hallway, no front
door, no kettle."

**SAY, as the first message lands:** "There is the first message. Not an alarm. One
short line to her daughter, at work."

**SAY, as the others land:** "It says it again only when it gets worse. Three messages
across five hours, not sixteen."

**DO:** move the cursor onto the top message and leave it there.

**SAY:** "That is all she gets. What is missing, when it was expected, how unusual that
is for her. It never guesses at why. It will not say she may have fallen."

> This is the hero shot. It is the only moment that shows time, absence and consequence
> in one continuous take, which is why it is worth fifteen seconds of a three minute
> video. Do not narrate over the whole thing; leave a beat of silence as each message
> lands.

### 1:18 to 1:50 · The part that matters: ask it why

**DO:** click the **microphone** and say, clearly: *"Why did you message me?"*

**SCREEN:** the device answers out loud and the card changes to the exact message that
was sent, with a list of the habits that were missing.

**SAY, once it has finished speaking:** "It is not writing that explanation now. It is
recalling the message it actually sent, and the habits that were missing."

**DO:** point the cursor at the small grey line under the input box.

**SAY:** "Bedrock picked the tool, the MCP server answered. A system that cannot tell
you why it rang you is one you stop trusting."

### 1:50 to 2:10 · It remembers

**DO:** click the microphone and say *"She's away next week."* Wait for the reply, then
click the **"She's back"** chip.

**SCREEN:** it confirms monitoring is paused until a date, then confirms it is watching
again.

**SAY:** "Tell it she is away and it stops raising alerts, but keeps recording so the
routine is not lost. Tell it she is back and it starts watching."

### 2:10 to 2:35 · Underneath

**DO:** switch to the terminal already showing the MCP Inspector tool list. Hold for
three seconds. Then switch to the MCP App screenshot or the reference host window.

**SAY:** "Underneath this is a real MCP server on AWS. Streamable HTTP, five tools, on
the current spec. That is the standard MCP Inspector listing them from the live
endpoint. It ships its own screen too, as an MCP App, so an Echo Show can draw this."

**SAY:** "The model only picks the tool. The words come from the server, so it cannot
invent something about somebody's mother. And it checks the cameras were working before
it calls anything missing. A flat battery and an unconscious person look the same from
outside, and one of those is a maintenance job."

### 2:35 to 2:50 · Honest close

**DO:** switch back to the browser.

**SAY:** "The Echo Show here is simulated, because the Alexa+ developer tools are not
open to entrants yet. Everything behind it is real. For a family it is: link the
cameras, Mum agrees, a fortnight of learning. Then you can just ask. StillThere."

---

## Part 5: after recording

- [ ] Trim to under 3:00. Check the spoken replies are audible.
- [ ] Watch it full screen once, looking for anything sensitive: the access code, an AWS
      console, a mail notification, another tab.
- [ ] Upload to **YouTube as Public**. The rules say publicly visible, so unlisted is a
      risk. No music unless you hold the rights.
- [ ] Title: *StillThere: notices the things that didn't happen (Alexa+ / MCP)*. Put the
      live link and the repo in the description.
- [ ] Paste the link into the Devpost form, and into the README under *Try it*.

## If something goes wrong mid-take

- **Speech is not recognised:** type the question instead. It is the same code path, so
  nothing about the demo changes.
- **It says monitoring is paused when you do not expect it:** a previous take left a
  pause. Click **She's back**, reload, and start again.
- **The phone is empty at 12:30:** the nightly reset did not run today. See the checklist.
- **The first answer is slow:** that is a cold start, about a second and a half. Ask one
  throwaway question before you record.
- **The play button runs past the end:** it stops at 13:00 on its own. To replay, drag
  the slider back to 08:00 and press play again.
