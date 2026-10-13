# Demo video: script and recording checklist

Target **2:50**. The rules allow under three minutes, and judges may stop at 3:00.
About 400 words of narration at a calm pace. Every number said aloud below matches
what the live app shows after the nightly reset.

## Before you record

- [ ] **Record on a day the reset has run.** It runs at 00:05 London time. Open the app
      and check the phone at 12:30 shows three messages: 09:00, 10:45 and 12:30.
      If not, run it by hand:
      `AWS_PROFILE=gt aws lambda invoke --function-name still-there-dev-demo-reset /tmp/r.json`
- [ ] **Chrome**, a fresh window at about 1500 × 1000, zoom 100%, bookmarks bar hidden,
      no other tabs. Speech recognition only works in Chrome.
- [ ] Enter the access code **before** you start recording. It is remembered in the browser.
- [ ] Top right: **Spoken replies on**.
- [ ] Click the mic once off-camera so Chrome's microphone permission prompt is already done.
- [ ] Do Not Disturb on. Quit Slack, Mail and anything else that pops up.
- [ ] **Capture system audio**, or the spoken replies will be missing. macOS's own
      Cmd+Shift+5 records the mic only. Use **OBS** (30 or later) with a *macOS Screen
      Capture* source with audio enabled, plus your mic as a second source.
- [ ] For the Inspector shot, have the terminal ready with the output **already on screen**
      and the command scrolled out of view. The command contains the access code; it
      must not appear in the video. Run it from outside the project folder, or npm
      echoes the full command, code included.
- [ ] Have the README's *How it works* diagrams open in a second window for 2:10.
- [ ] Do one full dry run. Read the narration aloud with a stopwatch.

## Script

Timings are targets. **VO** is your narration, **DO** is what you click,
**SAYS** is what the device says back.

### 0:00 – 0:15 · The hook

**Screen:** the app at 08:00, phone showing *No notifications*.

**VO:** "My mum lives alone. Security cameras tell you when something happens. But the
day I actually dread is the one where *nothing* does. This is StillThere, on Alexa+."

### 0:15 – 0:35 · What it is

**DO:** nothing yet. Let the timeline sit.

**VO:** "Over a few weeks it learns her normal day: up and about by half seven, out of
the front door, in the kitchen by quarter past eight. It only counts something as a
habit if it holds nineteen days in twenty. It's eight o'clock now. She's a little later
than usual, but still inside her own normal range, so StillThere stays quiet."

### 0:35 – 1:10 · The morning that didn't happen

**DO:** click **09:30** on the demo clock. Pause one beat on the phone.

**VO:** "Half past nine. Still nothing. Her daughter gets one short message."

**DO:** click **12:30**. Let the second and third messages land.

**VO:** "By lunchtime it's said so three times, and no more. Once when something looked
different, again only when it got worse. It never guesses at causes. It won't say she
might have fallen. It says what's missing, and how unusual that is for *her*."

### 1:10 – 1:45 · Asking why

**DO:** click the **mic** and say: *"Why did you message me?"*

**SAYS:** "I messaged you at 12:30 because there was no sign of her being up…"

**VO** (over the card): "This is the part that matters. It isn't making an explanation
up. It recalls the exact message it sent and the habits behind it, and how reliable each
one has been. Underneath, you can see Bedrock picked the tool, and the MCP server
answered."

**DO:** point the cursor at the trace line under the input for a second.

### 1:45 – 2:10 · It remembers

**DO:** mic: *"She's away next week."*

**SAYS:** "Right. I'll stop watching until …"

**DO:** mic: *"Is Jasmine up yet?"* It answers that monitoring is paused.

**DO:** click **She's back**.

**VO:** "Tell it she's away and it stops raising alerts, but keeps learning. Every
conversation after that knows. Tell it she's back and it starts watching again."

### 2:10 – 2:35 · Under the hood

**Screen:** terminal with MCP Inspector `tools/list` output, five tools visible.
Then the architecture diagram.

**VO:** "StillThere is a real MCP server on AWS, speaking the 2025-11-25 spec over
Streamable HTTP. Here's the standard MCP Inspector listing its five tools from the live
endpoint. The model only chooses the tool. The words come from the server, so it can't
invent facts about anybody's mother. It checks the cameras were working before it
calls anything missing. A flat battery is a maintenance job, not an alarm."

### 2:35 – 2:50 · Honest close

**Screen:** back to the app at 12:30.

**VO:** "The Echo Show here is simulated, because Alexa+ developer tools aren't open to
hackathon entrants yet. Everything behind it is real, and built to Amazon's Alexa+ MCP
requirements. For a family, setting it up is: link the cameras, Mum agrees, two weeks
of learning. Then you can just ask. StillThere."

## After recording

- [ ] Trim to under 3:00. Check the audio of the spoken replies is audible.
- [ ] Watch it once at full screen for anything sensitive: access code, AWS console,
      email notifications, other tabs.
- [ ] Upload to **YouTube as Public** (the rules say publicly visible; unlisted is a
      risk). No music unless you hold the rights to it.
- [ ] Title: *StillThere — notices the things that didn't happen (Alexa+ / MCP)*.
      Put the live link and the repo in the description.
- [ ] Paste the YouTube link into the Devpost form, and into the README under *Try it*.

## If something goes wrong mid-take

- **Speech isn't recognised:** type the question instead. It goes through the same
  path, so nothing about the demo changes.
- **"Monitoring is paused" when you don't expect it:** a previous take left a pause.
  Click **She's back**, then start again.
- **The phone is empty at 12:30:** the reset did not run today. Invoke it by hand (see
  the first checklist item) and reload.
- **A slow first answer:** that's a cold start, around a second and a half. Do a warm-up
  question before you hit record.
