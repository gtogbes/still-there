/**
 * Public landing page.
 *
 * The page anyone evaluating the project lands on first, and the App Homepage Ring
 * sends a user to after linking. Its job is to explain StillThere to somebody who has
 * never heard of it, then point them at the two things they can try: the simulated
 * Alexa+ device, and the MCP server behind it.
 *
 * Hard constraint: this URL is public and unauthenticated, so it shows no device
 * names, no rooms, no timings and no activity from any household. That is a movement
 * log of somebody's home. The example conversation below is written into the page,
 * not read from the data.
 */

interface LambdaResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Links {
  readonly repo: string;
  readonly web: string;
  readonly mcp: string;
}

function page(links: Links): string {
  const repo = escapeHtml(links.repo);
  const web = escapeHtml(links.web);
  const mcp = escapeHtml(links.mcp);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>StillThere: notices the things that didn't happen</title>
  <meta name="description" content="StillThere learns an older relative's daily routine and tells family when the usual activity doesn't happen. Ask it on Alexa+.">
  <meta name="robots" content="noindex">
  <style>
    :root {
      color-scheme: light dark;
      --ink: #1d1a14;
      --muted: #5c574d;
      --bg: #f7f4ee;
      --card: #ffffff;
      --line: #e3ddd1;
      --link: #0a55ad;
      --screen: #0f1d33;
      --screen-ink: #eef2f8;
      --screen-muted: #a9b6c9;
      --alexa: #19c3ef;
      --amber: #f2a93b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ink: #ece8e0;
        --muted: #aaa397;
        --bg: #16140f;
        --card: #1f1c16;
        --line: #36322a;
        --link: #8cbcff;
      }
    }
    * { box-sizing: border-box; }
    body {
      font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--ink); background: var(--bg);
      margin: 0 auto; padding: 2.25rem 1.1rem 3.5rem; max-width: 46rem;
      background-image:
        radial-gradient(42rem 28rem at 6% -6%, rgba(255, 244, 222, 0.85), transparent 62%),
        radial-gradient(34rem 26rem at 96% 2%, rgba(214, 231, 248, 0.6), transparent 64%);
      background-attachment: fixed;
      -webkit-text-size-adjust: 100%;
    }
    @media (min-width: 40em) { body { padding: 3rem 1.5rem 4rem; } }
    @media (prefers-color-scheme: dark) {
      body {
        background-image:
          radial-gradient(42rem 28rem at 6% -6%, rgba(60, 52, 38, 0.6), transparent 62%),
          radial-gradient(34rem 26rem at 96% 2%, rgba(32, 46, 64, 0.55), transparent 64%);
      }
    }
    h1 {
      font-size: clamp(1.8rem, 7.5vw, 2.7rem); line-height: 1.1;
      margin: 0 0 .75rem; letter-spacing: -.025em; text-wrap: balance;
    }
    .lede { font-size: 1.15rem; color: var(--muted); margin: 0 0 1.75rem; }
    h2 { font-size: 1.25rem; margin: 3rem 0 .75rem; letter-spacing: -.01em; }
    h3 { font-size: 1rem; margin: 1.25rem 0 .25rem; }
    p, li { color: var(--ink); }
    .quiet { color: var(--muted); }
    .tag {
      display: inline-block; font-size: .75rem; letter-spacing: .06em;
      text-transform: uppercase; color: var(--muted);
      border: 1px solid var(--line); border-radius: 100px;
      padding: .2rem .75rem; margin-bottom: 1.25rem;
    }
    .actions { display: flex; flex-wrap: wrap; gap: .6rem; margin: 0 0 .75rem; }
    .button {
      display: block; flex: 1 1 14rem; text-align: center;
      padding: .8rem 1.2rem; border-radius: 100px;
      font-weight: 600; text-decoration: none; border: 1px solid var(--ink);
      transition: transform .12s ease, box-shadow .2s ease;
    }
    .button:active { transform: scale(.985); }
    .button.primary {
      background: var(--ink); color: var(--bg);
      box-shadow: 0 10px 24px -10px rgba(40, 32, 20, .55);
    }
    @media (min-width: 40em) { .button { flex: 0 0 auto; display: inline-block; } }
    .button.secondary { color: var(--ink); }
    .button:focus-visible, a:focus-visible { outline: 3px solid var(--link); outline-offset: 3px; }
    .note { font-size: .9rem; color: var(--muted); margin: 0; }

    /* A small, static rendition of the Echo Show screen. Nothing here is live. */
    .screen {
      background: linear-gradient(145deg, #142544, var(--screen) 55%);
      color: var(--screen-ink);
      border: 8px solid #1b1b1f; border-radius: 20px;
      padding: 1.15rem 1.15rem 1.3rem; margin: 1.75rem 0 .5rem;
      box-shadow:
        inset 0 0 0 1px rgba(146, 180, 222, .16),
        inset 0 18px 40px -26px rgba(214, 238, 255, .35),
        0 24px 50px -22px rgba(40, 32, 20, .45);
    }
    @media (min-width: 40em) {
      .screen { border-width: 10px; border-radius: 22px; padding: 1.4rem 1.5rem 1.5rem; margin-top: 2rem; }
    }
    .screen .said { text-wrap: balance; }
    .screen .asked { color: var(--screen-muted); font-style: italic; margin: 0 0 .4rem; }
    .screen .said { font-size: 1.2rem; font-weight: 600; line-height: 1.35; margin: 0 0 .5rem; }
    .screen .detail { color: var(--screen-muted); margin: 0; }
    .screen .heard { display: inline-block; width: .55rem; height: .55rem; border-radius: 50%; background: var(--alexa); margin-right: .45rem; }
    .caption { font-size: .85rem; color: var(--muted); margin: 0 0 1rem; }

    .card {
      border: 1px solid var(--line); border-radius: 14px;
      padding: 1rem 1.1rem; background: var(--card); margin: 1rem 0;
      box-shadow: 0 10px 28px -18px rgba(40, 32, 20, .3);
    }
    @media (min-width: 40em) { .card { padding: 1.1rem 1.35rem; } }
    .phone {
      border-left: 3px solid var(--amber); background: var(--card);
      border-radius: 10px; padding: .85rem 1.1rem; margin: .75rem 0; font-size: .97rem;
    }
    .phone p { margin: 0; }
    .phone .meta { color: var(--muted); font-size: .82rem; margin-bottom: .2rem; letter-spacing: .03em; }
    ol.steps { list-style: none; counter-reset: s; padding: 0; }
    ol.steps > li { counter-increment: s; position: relative; padding-left: 2.5rem; margin: 1.1rem 0; }
    ol.steps > li::before {
      content: counter(s);
      position: absolute; left: 0; top: .1rem;
      width: 1.7rem; height: 1.7rem; border-radius: 50%;
      background: var(--ink); color: var(--bg);
      display: grid; place-items: center; font-size: .85rem; font-weight: 600;
    }
    ul.plain { padding-left: 1.2rem; }
    ul.plain li { margin: .4rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: .95rem; }
    th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
    @media (max-width: 34em) {
      table, tbody, tr, th, td { display: block; }
      th[scope="row"] { border: 0; padding-bottom: 0; }
      td { padding-top: .15rem; }
      tr { padding: .35rem 0; border-bottom: 1px solid var(--line); }
    }
    th { font-weight: 600; color: var(--muted); font-size: .8rem; letter-spacing: .04em; text-transform: uppercase; }
    code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--card); border: 1px solid var(--line); border-radius: 5px; padding: .05rem .35rem; white-space: nowrap; display: inline-block; margin: .1rem 0; }
    code.url { white-space: normal; word-break: break-all; display: inline; }
    a { color: var(--link); }
    hr { border: 0; border-top: 1px solid var(--line); margin: 3rem 0 1.5rem; }
    footer { font-size: .875rem; color: var(--muted); }
    footer p { margin: .5rem 0; }
  </style>
</head>
<body>
  <main>
    <p class="tag">Amazon Developer Hackathon &middot; Alexa+</p>
    <h1>Notices the things that didn&rsquo;t happen.</h1>
    <p class="lede">
      StillThere learns the daily rhythm of an older relative&rsquo;s home, and gets in
      touch when the usual activity <strong>doesn&rsquo;t</strong> happen. Then, on
      Alexa+, the family can simply ask what&rsquo;s going on.
    </p>

    <div class="actions">
      <a class="button primary" href="${web}">Try it on a simulated Echo Show</a>
      <a class="button secondary" href="${repo}">Read the code</a>
    </div>
    <p class="note">The access code is in the Devpost testing instructions. Chrome is best if you want to speak to it.</p>

    <div class="screen" role="img" aria-label="Example: the Echo Show answering why it sent a message">
      <p class="asked"><span class="heard" aria-hidden="true"></span>&ldquo;Alexa, why did you message me about Mum?&rdquo;</p>
      <p class="said">I messaged you at 12:30 because there was no sign of her being up.</p>
      <p class="detail">
        She&rsquo;s usually up and about by half seven, which has held on 30 of the last 30
        comparable days. The hallway, front door and kitchen were quiet too.
      </p>
    </div>
    <p class="caption">An example conversation, written into this page. The live version answers from the real server.</p>

    <h2>The problem</h2>
    <p>
      If you have a parent living alone, you probably check in when you remember and
      worry in between. Security cameras tell you when something <em>happens</em>. The
      day you actually dread is the one where <em>nothing</em> does.
    </p>
    <p>
      Panic buttons only work if someone can press them. Amazon&rsquo;s own Alexa Together
      was withdrawn in 2025 in favour of Emergency Assist, which also relies on somebody
      asking for help. The days that matter are the days nobody can.
    </p>

    <h2>What StillThere does instead</h2>
    <ol class="steps">
      <li>
        <h3>It learns the routine</h3>
        <p class="quiet">
          Over a few weeks it works out the shape of an ordinary day: up and about
          by half seven, out of the front door by ten to eight, in the kitchen by quarter
          past. It only treats something as a habit if it holds on more than nineteen
          days in twenty. Anything less reliable would just be noise.
        </p>
      </li>
      <li>
        <h3>It watches for what&rsquo;s missing</h3>
        <p class="quiet">
          Once a habit is later than this person&rsquo;s own normal range, rather than a
          fixed schedule, it sends one short message. If the morning gets worse it says so
          again, at most three times a day.
        </p>
        <div class="phone">
          <p class="meta">STILLTHERE &middot; 09:00 &middot; A small change today</p>
          <p>Jasmine has not yet been up today, usually by half seven and it&rsquo;s now nine.</p>
        </div>
      </li>
      <li>
        <h3>It answers questions about it</h3>
        <p class="quiet">
          &ldquo;Is she up yet?&rdquo; &ldquo;Why did you message me?&rdquo; &ldquo;What&rsquo;s her
          normal day like?&rdquo; &ldquo;She&rsquo;s away next week.&rdquo; The explanation is the
          record of what was actually sent and why, recalled rather than made up again.
        </p>
      </li>
    </ol>

    <h2>What it doesn&rsquo;t do</h2>
    <div class="card">
      <ul class="plain">
        <li><strong>No live feed to watch.</strong> It reads when things happened, not video.</li>
        <li>
          <strong>No guessing at causes.</strong> It will say the kitchen has been quiet. It
          will never say she may have fallen. Every message is checked for that before
          it is sent.
        </li>
        <li>
          <strong>It won&rsquo;t mistake the cat for your mother.</strong> Only movement
          classified as a person counts as someone being up.
        </li>
        <li>
          <strong>It won&rsquo;t cry wolf over a flat battery.</strong> Before concluding
          nothing happened, it checks the cameras were working. If they weren&rsquo;t,
          that is a maintenance job, not a welfare alert, and the family is not told.
        </li>
      </ul>
    </div>

    <h2>For developers</h2>
    <p>
      StillThere is an MCP server first. The Echo Show above is one client; any MCP
      client can be another.
    </p>
    <table>
      <tr><th scope="row">Endpoint</th><td><code class="url">${mcp}</code></td></tr>
      <tr><th scope="row">Protocol</th><td>MCP 2025-11-25, Streamable HTTP</td></tr>
      <tr><th scope="row">Auth</th><td><code>Authorization: Bearer &lt;access code&gt;</code></td></tr>
      <tr>
        <th scope="row">Tools</th>
        <td>
          <code>still_there_status</code> <code>explain_last_alert</code>
          <code>describe_routine</code> <code>pause_monitoring</code> <code>resume_monitoring</code>
        </td>
      </tr>
    </table>
    <p class="quiet">
      Every tool returns a sentence for speech and structured content for a screen. On
      the simulated device, Amazon Bedrock chooses the tool and the server&rsquo;s own words
      are spoken, so the assistant cannot invent facts about anyone.
    </p>

    <h2>What is real, and what is simulated</h2>
    <p>
      <strong>Real:</strong> the MCP server, the routine learning, the assessment that
      runs every fifteen minutes, the messages and the record of why each was sent,
      all running on AWS.
    </p>
    <p>
      <strong>Simulated:</strong> the Echo Show, because Alexa+ developer tools are not
      yet open to hackathon entrants; and the household. Jasmine is a synthetic resident
      with six weeks of generated history, rebuilt every night so the demo tells the
      same story whichever day you visit. No real person&rsquo;s home is behind this page.
    </p>

    <hr>

    <h2>If you connect a real home</h2>
    <h3>Disconnecting</h3>
    <p>
      Remove StillThere in the <strong>Ring app</strong>, under your account&rsquo;s connected
      apps. Ring revokes our access immediately and tells us it has done so.
    </p>
    <p>
      When that message arrives we <strong>delete everything</strong>: the access
      tokens, the event history, the learned routine, the room assignments and the
      record of past notifications. Not marked for expiry. Deleted.
    </p>
    <h3>What we keep while you&rsquo;re connected</h3>
    <ul class="plain">
      <li>Event records: which device, what kind of movement, when. Deleted after 90 days regardless.</li>
      <li>Which room each device is in, so movement indoors can be told from movement outside.</li>
      <li>Encrypted access tokens for your Ring account.</li>
      <li>A record of each message sent, so &ldquo;why did you contact me that Tuesday&rdquo; has an answer.</li>
    </ul>
    <p class="quiet">No video, and no images.</p>

    <hr>

    <footer>
      <p>
        A hackathon project, not a medical or emergency service, and not a substitute
        for one. In an emergency, call your local emergency number.
      </p>
      <p>Open source, MIT licensed. <a href="${repo}">Read the code</a>.</p>
    </footer>
  </main>
</body>
</html>`;
}

/** Treats an unset or empty environment variable the same way. */
function configured(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export async function handler(): Promise<LambdaResponse> {
  const links: Links = {
    repo: configured(process.env['REPO_URL'], 'https://github.com/gtogbes/still-there'),
    // WEB_URL is set from the web_domain variable, not from the distribution's
    // own attribute: these functions are an origin of that distribution, so
    // referencing it from here would be a dependency cycle. It is empty when no
    // custom domain is configured, hence the fallback.
    web: configured(process.env['WEB_URL'], 'https://stillthere.ogbes.com'),
    mcp: configured(
      process.env['MCP_URL'],
      'https://eop88u898f.execute-api.us-east-1.amazonaws.com/mcp',
    ),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      // Nothing is fetched from anywhere and there is no script, so the policy can
      // be this tight. Inline styles are the only exception.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000',
    },
    body: page(links),
  };
}
