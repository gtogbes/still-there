---
title: "Building an MCP server for Alexa+ that explains itself: Lambda, Bedrock and MCP Apps"
published: false
description: "How I built StillThere, an MCP server that notices the daily activity that didn't happen in an older relative's home, for the Amazon Developer hackathon."
tags: mcp, aws, alexa, serverless
cover_image: https://raw.githubusercontent.com/gtogbes/still-there/main/docs/screenshots/04-why-did-you-message-me.png
---

Most home monitoring tells you when something *happens*. For a parent living alone, the day you dread is the one where *nothing* does.

**StillThere** learns an older person's daily rhythm (up by half seven, front door by ten to eight, kitchen by quarter past) and notices when that rhythm doesn't happen. It sends the family one short message. Then they can ask Alexa *why*.

> **"Alexa, why did you message me about Mum?"**
>
> "I messaged you at 12:30 because there was no sign of her being up. She's usually up and about by 07:37, held on 30 of the last 30 comparable days. The hallway, front door and kitchen were quiet too."

I built it for the Alexa+ track of the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/). It's an MCP server running on AWS Lambda, with Amazon Bedrock choosing tools and an MCP Apps view for Echo Show screens. This post covers how to build that kind of server, and the things that bit me on the way.

- **Code (MIT):** https://github.com/gtogbes/still-there
- **Live demo:** https://stillthere.ogbes.com (behind an access code, because each question costs a Bedrock call. Clone it and deploy your own; it's about $2.50 a month.)

## The shape of it

Two halves. One watches; the other answers questions.

```
events ─▶ DynamoDB ─▶ every 15 min: learn baseline ─▶ assess ─▶ Bedrock words it ─▶ SNS

browser ─▶ CloudFront ─▶ /api/assistant ─▶ Bedrock picks a tool ─┐
                     └─▶ /api/mcp ───────────────────────────────┼─▶ MCP server (Lambda)
any MCP client ─▶ POST /mcp (Bearer) ────────────────────────────┘
```

A note on "Alexa+": its MCP Toolkit and simulator are currently available to select partners only, and the hackathon FAQ says entrants can't get access. So, as the FAQ suggests, I built the MCP server for real and a simulated Echo Show web app as the client. The server is checked against Amazon's published Alexa+ MCP requirements, and I'll come back to those at the end.

## 1. Design tools to be asked, not read

The biggest shift from building an API is that the caller is a voice assistant working out intent from a sentence. So the tool description is effectively your routing logic. Put the phrases people will actually say into it:

```ts
registerAppTool(
  server,
  'still_there_status',
  {
    _meta: VIEW, // the MCP Apps link. More on this in section 5.
    title: 'Check on the household',
    description:
      'Whether the resident appears to be having a normal day, or whether a usual ' +
      'activity is overdue. Use for "is Mum up yet", "is everything alright", "any news".',
    inputSchema: {},
  },
  async () => result(householdStatus(/* … */)),
);
```

StillThere has five tools: `still_there_status`, `explain_last_alert`, `describe_routine`, `pause_monitoring` and `resume_monitoring`. Three rules shaped all of them.

**Return two things every time.** A complete spoken sentence in `content`, and the same facts as `structuredContent` for a screen. One server then serves a voice-only Echo Dot and an Echo Show without either compromising.

```ts
function result<T extends object>(answer: ToolAnswer<T>) {
  return {
    content: [{ type: 'text' as const, text: answer.text }],
    structuredContent: answer.data as Record<string, unknown>,
  };
}
```

**Write the text for the ear.** No ISO dates, no "1.5 hours", no raw minute counts. "About two hours later than usual" rather than "152 minutes past". I rewrote these strings more often than any code.

**Answer what's true, not what's convenient.** At 08:00, Jasmine's usual 07:30 has passed, but she's still inside her normal range. "Nothing is overdue" is true and useless. The tool now says *"Up and about is usually by 07:37, but a later start is still within her normal range."*

## 2. Run it on Lambda, statelessly

The MCP TypeScript SDK ships a Web Standards transport that speaks `Request` and `Response` rather than Node streams. That makes the Lambda bridge small. A trimmed version of the real handler:

```ts
import { WebStandardStreamableHTTPServerTransport } from
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const access = await checkAccess(event.headers);
  if (!access.allowed) return unauthorised(); // a bare 401. See section 6.

  const server = buildMcpServer({ tables, householdId, now });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true, // Lambda can't usefully hold an SSE stream open
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(toRequest(event, url));
    return { statusCode: response.status, headers: toHeaders(response), body: await response.text() };
  } finally {
    // Lambda freezes the container rather than tearing it down, so anything left
    // open leaks into the next invocation on the same container.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
```

Why these choices:

- **Stateless, a fresh server per request.** Lambda gives no affinity between requests, so a session would work until the next cold start. The 2025-11-25 spec allows stateless operation, and every tool reads its state from DynamoDB anyway.
- **`enableJsonResponse: true`** returns plain JSON instead of an SSE stream. API Gateway HTTP APIs buffer responses, so streaming buys you nothing here.
- **Close in `finally`**, even on success. This one is easy to miss.

## 3. Make the clock an argument

This is the decision I'd repeat on any project like this. Nothing in the reasoning code calls `Date.now()`. Every function takes the instant it should reason about.

```ts
export interface ServerDeps {
  readonly tables: TableNames;
  readonly householdId: string;
  /** The current instant, given the household's time zone. */
  readonly now: (timeZone: string) => number;
}
```

It paid for itself three times:

1. **Tests.** The suite replays 90 synthetic days in under a second, which is how I measured the false-positive rate: 0 unnecessary alerts per 30 days for a regular routine, about 1 for an irregular one.
2. **The demo.** A morning takes five hours and the video gets three minutes. The web app sends a `x-still-there-demo-minute` header, and the server answers "as of 09:30 today". It only moves the time of day, never the date, and the deployment has to switch it on explicitly.
3. **Replays.** The scheduled assessment can be asked about any moment, so the demo's three daily messages are produced by the *real* assessment run at 09:00, 10:45 and 12:30 by a nightly job, rather than written into the database by hand.

## 4. Let the model route, not narrate

The simulated Echo Show sends the user's words to `/api/assistant`. Bedrock (Nova Lite) gets the utterance and the server's live `tools/list` output, and picks a tool. The schemas pass straight through, with one fix:

```ts
export function toBedrockTools(tools: readonly McpTool[]): Tool[] {
  return tools.map((tool) => {
    // Bedrock's validator rejects the $schema key. Nothing else changes.
    const { $schema: _ignored, ...schema } = tool.inputSchema;
    return {
      toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: schema as never } },
    };
  });
}
```

The important part is what happens next: **the spoken reply is the tool's own text, not the model's prose.** The model can send a question to the wrong tool, but the worst case is a correct answer to the wrong question. It can never confidently invent something about somebody's mother.

```ts
toolConfig: { tools: toBedrockTools(options.tools), toolChoice: { auto: {} } },
// Routing needs determinism, not creativity, and very few tokens.
inferenceConfig: { temperature: 0, maxTokens: 200 },
```

Two more things that made this robust:

- **A keyword router as a fallback.** If Bedrock is slow, denied or down, the feature gets a slightly worse router. It doesn't go down.
- **The client connects over HTTP, like everyone else.** The assistant uses the SDK's `StreamableHTTPClientTransport` against the public `/mcp` URL with a Bearer token, not an in-process shortcut. Every spoken question therefore exercises the real endpoint, including the access check.

The alert messages are the one place a model writes prose. There, its output is treated as a *proposal*. A validator rejects anything that speculates about health ("she may have fallen"), claims footage was viewed, mentions a habit that wasn't assessed, or leaves out a clock time. When a message is rejected, the deterministic wording is sent instead. You can't prompt a model into *never* saying something; you can check what it said.

Cost: one Nova Lite call per spoken question. September's entire Bedrock bill was **$0.0004**.

## 5. Ship a screen with MCP Apps

[MCP Apps](https://apps.extensions.modelcontextprotocol.io/) lets a server ship its own UI as a `ui://` resource. A host renders it in a sandboxed iframe and hands it each tool result. Alexa+'s docs say it supports the extension, and the hackathon's judging guidance lists it as a creative choice for this track.

It's two registrations, tied together by a URI:

```ts
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool }
  from '@modelcontextprotocol/ext-apps/server';

export const VIEW_URI = 'ui://still-there/today.html';
const VIEW = { ui: { resourceUri: VIEW_URI } };

registerAppResource(server, "StillThere: today's view", VIEW_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({ contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: APP_HTML }] }),
);
// …and every tool gets `_meta: VIEW`, as in section 1.
```

Inside the view, the official `App` client receives results and can call tools back *through the host*:

```ts
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'StillThere', version: '0.3.0' });
app.ontoolresult = (result) => show(result); // set before connect()
app.onhostcontextchanged = (ctx) => ctx.theme && applyDocumentTheme(ctx.theme);
await app.connect();

// The "Check again" button. The view never talks to the server directly.
await app.callServerTool({ name: 'still_there_status', arguments: {} });
```

![The StillThere MCP App rendered in the official MCP Apps reference host](https://raw.githubusercontent.com/gtogbes/still-there/main/docs/screenshots/06-mcp-app-in-reference-host.png)

What I learned:

- **Pick the version that matches your SDK.** `ext-apps` 2.x needs MCP SDK v2. If you're on `@modelcontextprotocol/sdk` 1.x, pin `ext-apps` 1.7.x.
- **One self-contained HTML file.** The sandbox has no network access, so script and styles get inlined. I bundle with esbuild into a generated TypeScript module the Lambda imports, so there's nothing to deploy alongside the function.
- **Keep the rendering pure.** `renderView(structuredContent) → html` has no DOM dependency and is unit tested in Node, escaping included (a pause reason is typed by a family member). The browser glue is about 50 lines.
- **Watch the bundle size.** My first build was **520 KiB**. About 300 KiB of that was Zod's error messages in roughly fifty languages, pulled in through the client's validation. Replacing that one re-export with an empty module brought it to 263 KiB, with validation unchanged:

```js
// esbuild plugin, in scripts/build-mcp-app.mjs
setup(b) {
  b.onResolve({ filter: /^\.\.\/locales\/index\.js$/ }, (args) =>
    /[\\/]zod[\\/]/.test(args.importer) ? { path: 'zod-locales', namespace: 'stub' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export {};', loader: 'js' }));
}
```

- **Test it in the real reference host.** Clone [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) and run `examples/basic-host`. It expects an unauthenticated server on `localhost:3001`, so I added a small script that runs the same server bound to `127.0.0.1` against the dev tables. The screenshot above is that host, and the server log confirmed "Check again" round-tripped as a real `tools/call`.

## 6. Meet the Alexa+ requirements you can

Amazon publishes what an MCP server needs before Alexa+ will connect to it. Even without access to their tools, you can check most of it yourself:

| Requirement | How |
|---|---|
| MCP `2025-11-25` over Streamable HTTP | The SDK negotiates it; the transport above |
| `401` for unauthenticated requests, **without** a `WWW-Authenticate` header | I originally sent one, because that's the usual HTTP habit, then removed it |
| Bearer token in the `Authorization` header, never the query string | |
| Round trip under 500 ms | See below |
| OAuth 2.1 with PKCE for account linking | Not done. StillThere uses a shared demo access code |

**Latency** needed one change. Every status answer compares today against six weeks of history, about two thousand DynamoDB rows. That history ends at midnight and can't change during the day, so a warm container now keeps it for ten minutes. Time in the function dropped to 20–85 ms, and the full round trip from the UK is around 0.33 s. Cold starts are still about 1.4 s; provisioned concurrency would fix that for around $7 a month, which wasn't worth paying for a demo.

Before Amazon's simulator, their docs recommend testing the server in isolation with the standard MCP Inspector, which works against any remote server:

```bash
npx @modelcontextprotocol/inspector@2.10.1 --cli https://<your-api>/mcp \
  --transport http --header "Authorization: Bearer $CODE" --method tools/list
```

## 7. Keep a demo alive for the whole judging window

This one I nearly missed. Judging runs for two weeks after the deadline, and my seeded demo only told its story on the day I seeded it. The next day, device health was stale, yesterday's broken morning had become part of the "normal" baseline, and the phone showed no messages.

The fix was a nightly EventBridge Scheduler job at 00:05 in the household's time zone. It rebuilds six weeks of synthetic history and today's missing morning, then invokes the *deployed* assessment at three moments, so the day's messages go through Bedrock, validation and SNS like real ones. Because the job deletes data, it refuses to run unless the deployment is explicitly marked as a demo.

If your hackathon demo depends on time-sensitive data, check what it looks like a week from now.

## Things I got wrong

- **I planned for the Ring track first**, then found that Ring private apps need a real account with a Protect Plan. I didn't have the hardware, so I moved to Alexa+. The event adapter is still there, and strict about payload shapes for when real events arrive.
- **I guessed Ring's webhook payload shape** before reading the spec, and got nearly every field name wrong. Read the spec first.
- **`contact_sensor_faulted` means the door is open**, not that the sensor is broken.
- **Claude on Bedrock needed a use-case form** on my account, which surfaced as a `ResourceNotFoundException` rather than anything about access. Nova Lite does the routing job well, and costs less.
- **The SDK's `StreamableHTTPClientTransport` doesn't satisfy its own `Transport` type** under TypeScript's `exactOptionalPropertyTypes`. It's a typing quirk rather than a runtime one, so I cast it.
- **An AAAA record on a CloudFront distribution with IPv6 off** (the Terraform provider's default) quietly breaks IPv6-only visitors.

## What it costs

From the real bill, about **$2.50 a month**. That's mostly two fixed charges: a customer-managed KMS key ($1) and two Secrets Manager secrets ($0.80). Lambda, CloudFront, SNS and CloudWatch all sit inside the free tier. Everything is Terraform, including the custom domain.

## Try it, or build your own

The repo has the MCP server, the simulated Echo Show (React and Tailwind), the MCP App, the Terraform, and 234 tests. `npm run demo` runs the whole thing offline in about a second, with no AWS account needed.

I built this with [Kiro](https://kiro.dev) for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/). If you're building an MCP server for Alexa+ too, I'd like to hear how you're handling the parts above, especially auth before the OAuth flow, and testing without the Alexa+ simulator.

**Repo:** https://github.com/gtogbes/still-there
