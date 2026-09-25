/**
 * Public landing page.
 *
 * Its first job is to explain StillThere to somebody who has never heard of it —
 * Ring calls this the App Homepage and sends users here after linking, and it is
 * the page anyone evaluating the project will click first.
 *
 * Its second job is connection management, which is why the practical sections sit
 * below the explanation rather than above it.
 *
 * Hard constraint either way: this URL is public and unauthenticated, so it shows no
 * device names, no rooms, no timings and no activity. That is a movement log of
 * somebody's home. Anything personal waits behind sign-in.
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

function page(repoUrl: string): string {
  const repo = escapeHtml(repoUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>StillThere — notices the things that didn't happen</title>
  <meta name="description" content="StillThere learns an older relative's daily routine from their Ring devices and tells family when the usual activity doesn't happen.">
  <meta name="robots" content="noindex">
  <style>
    :root {
      color-scheme: light dark;
      --ink: #1a1a1a;
      --muted: #55595e;
      --bg: #fdfdfc;
      --card: #ffffff;
      --line: #e4e2de;
      --link: #0a55ad;
      --accent: #7a5cff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ink: #ededed;
        --muted: #a9adb3;
        --bg: #15171a;
        --card: #1e2125;
        --line: #32373c;
        --link: #86b8ff;
        --accent: #a892ff;
      }
    }
    * { box-sizing: border-box; }
    body {
      font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--ink); background: var(--bg);
      margin: 0 auto; padding: 3rem 1.25rem 4rem; max-width: 44rem;
    }
    h1 { font-size: clamp(1.8rem, 5vw, 2.4rem); line-height: 1.15; margin: 0 0 .5rem; letter-spacing: -.02em; }
    .lede { font-size: 1.15rem; color: var(--muted); margin: 0 0 2.5rem; }
    h2 { font-size: 1.2rem; margin: 2.75rem 0 .75rem; letter-spacing: -.01em; }
    h3 { font-size: 1rem; margin: 1.5rem 0 .35rem; }
    p, li { color: var(--ink); }
    .quiet { color: var(--muted); }
    .card { border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem 1.35rem; background: var(--card); margin: 1rem 0; }
    .alert {
      border-left: 3px solid var(--accent);
      background: var(--card); border-radius: 8px;
      padding: .9rem 1.15rem; margin: 1rem 0;
      font-size: .97rem;
    }
    .alert p { margin: 0; }
    .alert .meta { color: var(--muted); font-size: .85rem; margin-top: .4rem; }
    ol.steps { list-style: none; counter-reset: s; padding: 0; }
    ol.steps > li { counter-increment: s; position: relative; padding-left: 2.4rem; margin: 1.15rem 0; }
    ol.steps > li::before {
      content: counter(s);
      position: absolute; left: 0; top: .05rem;
      width: 1.65rem; height: 1.65rem; border-radius: 50%;
      background: var(--accent); color: #fff;
      display: grid; place-items: center;
      font-size: .85rem; font-weight: 600;
    }
    ul.plain { padding-left: 1.2rem; }
    ul.plain li { margin: .4rem 0; }
    a { color: var(--link); }
    a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; border-radius: 3px; }
    hr { border: 0; border-top: 1px solid var(--line); margin: 3rem 0 1.5rem; }
    footer { font-size: .875rem; color: var(--muted); }
    footer p { margin: .5rem 0; }
    .tag {
      display: inline-block; font-size: .75rem; letter-spacing: .06em;
      text-transform: uppercase; color: var(--muted);
      border: 1px solid var(--line); border-radius: 100px;
      padding: .2rem .7rem; margin-bottom: 1.25rem;
    }
  </style>
</head>
<body>
  <main>
    <p class="tag">Early build</p>
    <h1>Notices the things that didn&rsquo;t happen.</h1>
    <p class="lede">
      StillThere learns the daily rhythm of an older relative&rsquo;s home from the Ring
      devices already on the wall, and gets in touch when the usual activity
      <strong>doesn&rsquo;t</strong> happen.
    </p>

    <h2>The problem</h2>
    <p>
      If you have a parent living alone, you probably check in when you remember, and
      worry in between. Security cameras are no help: they tell you when something
      happens. The thing you actually dread is a day when <em>nothing</em> does.
    </p>
    <p>
      Panic buttons only work if someone can press them. Watching a live feed all day
      is neither practical nor a way anyone wants to live.
    </p>

    <h2>What StillThere does instead</h2>
    <ol class="steps">
      <li>
        <h3>It learns the routine</h3>
        <p class="quiet">
          Over a few weeks it works out the shape of an ordinary day — up and about by
          about half seven, out for the paper, in the kitchen by eight. It only treats
          something as a habit if it holds on more than nineteen days in twenty.
          Anything less is a coincidence, and nobody needs alerting about those.
        </p>
      </li>
      <li>
        <h3>It watches for what&rsquo;s missing</h3>
        <p class="quiet">
          Once the usual time has passed &mdash; plus a margin sized to how variable
          that particular person is &mdash; and the thing still hasn&rsquo;t happened,
          it says so.
        </p>
      </li>
      <li>
        <h3>It explains itself</h3>
        <p class="quiet">Not an alarm. A nudge, with its reasoning attached:</p>
        <div class="alert">
          <p>No sign of activity in the hallway yet today.</p>
          <p class="meta">
            Usually by 07:32. Seen on 30 of the last 30 working days. It&rsquo;s now
            11:24 &mdash; about two and a half hours later than normal.
          </p>
        </div>
        <p class="quiet">
          You decide whether that means anything. Most days it will say nothing at all,
          which is the point.
        </p>
      </li>
    </ol>

    <h2>What it doesn&rsquo;t do</h2>
    <div class="card">
      <ul class="plain">
        <li><strong>No live feed to watch.</strong> It reads event records, not video.</li>
        <li>
          <strong>No footage stored, ever.</strong> It looks at a single image only if
          something genuinely appears wrong, and records that it did so.
        </li>
        <li>
          <strong>No new hardware.</strong> It uses the Ring devices already installed.
        </li>
        <li>
          <strong>It won&rsquo;t mistake the cat for your mother.</strong> Ring tells us
          whether movement looked like a person, and only a person counts as someone
          being up.
        </li>
        <li>
          <strong>It won&rsquo;t cry wolf over a flat battery.</strong> Before concluding
          nothing happened, it checks the cameras were actually working. If they
          weren&rsquo;t, it says so &mdash; that&rsquo;s a maintenance job, not a
          welfare alert.
        </li>
      </ul>
    </div>

    <h2>Who it&rsquo;s for</h2>
    <p>
      Adult children of a parent living alone who want reassurance without surveillance,
      and without asking someone in their eighties to wear or charge anything.
    </p>

    <hr>

    <h2>Managing your connection</h2>
    <p>
      Your household&rsquo;s activity is only visible after signing in, so none of it
      appears on this page.
    </p>
    <p>
      <strong>The sign-in screens are not part of this build yet.</strong> The Ring
      integration, the routine learning and the alerting all work; the account pages
      do not exist. Disconnecting is unaffected &mdash; see below.
    </p>

    <h3>Disconnecting</h3>
    <p>
      Remove StillThere in the <strong>Ring app</strong>, under your account&rsquo;s
      connected apps. That is the real control: Ring revokes our access immediately and
      tells us it has done so, and we stop receiving events and delete the tokens we
      hold.
    </p>

    <h3>What we keep</h3>
    <ul class="plain">
      <li>Event records &mdash; which device, what kind of movement, when. Deleted after 90 days.</li>
      <li>Which room each device is in, so movement indoors can be told from movement outside.</li>
      <li>Encrypted access tokens for your Ring account, deleted when you disconnect.</li>
    </ul>

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

export async function handler(): Promise<LambdaResponse> {
  const repoUrl = process.env['REPO_URL'] ?? 'https://github.com/gtogbes/still-there';

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
    body: page(repoUrl),
  };
}
