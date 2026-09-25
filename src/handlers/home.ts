/**
 * App Homepage.
 *
 * Ring sends users here after linking completes, and lists it as where they manage
 * their connection. It is reachable by anyone who has the URL.
 *
 * Which decides what it can contain. This page deliberately shows no device names,
 * no zones, no timings and no activity, because all of that is a movement log of
 * somebody's home and this endpoint has no authentication. Anything personal waits
 * behind sign-in.
 *
 * What it can honestly offer is the part users actually need: an explanation of what
 * the integration does, and how to revoke it. Revocation genuinely lives in the Ring
 * app rather than here — Ring lets a user remove an integration directly, which fires
 * `app_integration_removed` and invalidates our tokens. Pointing at the real control
 * beats building a worse copy of it.
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>StillThere</title>
  <meta name="robots" content="noindex">
  <meta name="description" content="StillThere notices when an older relative's usual daily activity does not happen.">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
      margin: 0 auto; padding: 2rem 1.25rem; max-width: 40rem;
      /* 15.8:1 against the background, comfortably past WCAG AA. */
      color: #1a1a1a; background: #fdfdfc;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #ececec; background: #16181a; }
      .card { background: #1f2224 !important; border-color: #33383b !important; }
      a { color: #7fb3ff !important; }
    }
    h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
    .tagline { color: #5a5a5a; margin: 0 0 2rem; }
    @media (prefers-color-scheme: dark) { .tagline { color: #a8a8a8; } }
    h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
    .card { border: 1px solid #e3e1dd; border-radius: 10px; padding: 1rem 1.25rem; background: #fff; }
    ol, ul { padding-left: 1.25rem; }
    li { margin: .35rem 0; }
    a { color: #0b5fbf; }
    a:focus-visible { outline: 3px solid #0b5fbf; outline-offset: 2px; border-radius: 2px; }
    footer { margin-top: 2.5rem; font-size: .875rem; color: #5a5a5a; }
    @media (prefers-color-scheme: dark) { footer { color: #a8a8a8; } }
  </style>
</head>
<body>
  <main>
    <h1>StillThere</h1>
    <p class="tagline">Notices the things that didn&rsquo;t happen.</p>

    <div class="card">
      <p>
        StillThere learns the daily rhythm of a household from its Ring devices &mdash;
        movement indoors, a door opening &mdash; and gets in touch with family when the
        usual activity <strong>doesn&rsquo;t</strong> occur. Not an alarm. A nudge, with its
        reasoning attached.
      </p>
      <p>
        It reads event records rather than watching video, and only looks at an image
        if something genuinely appears wrong.
      </p>
    </div>

    <h2>Managing your connection</h2>
    <p>
      Your household&rsquo;s activity is only visible after signing in, so none of it
      appears on this page.
    </p>
    <p>
      <strong>The sign-in surface is not part of this preview.</strong> StillThere is an
      early build: the Ring integration, the routine learning and the alerting all work,
      and the account screens do not exist yet. Disconnecting is unaffected &mdash; see
      below, it is handled entirely in the Ring app.
    </p>

    <h2>Disconnecting</h2>
    <p>
      Remove the StillThere integration in the <strong>Ring app</strong>, under your
      account&rsquo;s connected apps. That is the authoritative control: Ring revokes our
      access immediately and tells us it has done so, at which point we stop receiving
      events and delete the tokens we hold.
    </p>

    <h2>What we keep</h2>
    <ul>
      <li>Event records &mdash; which device, what kind, when. Deleted after 90 days.</li>
      <li>Which room each device is in, so movement indoors can be told from movement outside.</li>
      <li>Access tokens for your Ring account, encrypted, deleted when you disconnect.</li>
    </ul>
    <p>No video or images are stored.</p>

    <footer>
      <p>
        A hackathon project, not a medical or emergency service. In an emergency,
        contact your local emergency number.
      </p>
      <p><a href="${escapeHtml(repoUrl)}">Source code</a></p>
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
      // No personal data here, but no reason to let it be cached for long either.
      'Cache-Control': 'public, max-age=300',
      // Nothing is loaded from anywhere else and there is no script, so the policy
      // can be this tight.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000',
    },
    body: page(repoUrl),
  };
}
