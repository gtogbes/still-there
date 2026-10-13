/**
 * Browser glue for the StillThere MCP App.
 *
 * Bundled by scripts/build-mcp-app.mjs into one self-contained HTML document and
 * served by the MCP server as `ui://still-there/today.html`. The host renders it in
 * a sandboxed iframe; this script connects to the host over postMessage, receives
 * each tool result, and draws it. Rendering itself is in src/mcp/app-view.ts, which
 * has no DOM dependency and is unit tested.
 *
 * The one interactive control is "Check again", which calls still_there_status
 * through the host. The view never talks to the server directly: the host decides
 * whether that call is allowed.
 */
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { renderView } from '../src/mcp/app-view.js';

const root = document.getElementById('root') as HTMLElement;
const refresh = document.getElementById('refresh') as HTMLButtonElement;

const app = new App({ name: 'StillThere', version: '0.3.0' });

interface ToolResultLike {
  readonly structuredContent?: unknown;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly isError?: boolean;
}

function show(result: ToolResultLike): void {
  const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
  root.innerHTML = renderView(result.isError === true ? undefined : result.structuredContent, text);
}

// Set before connect(), so the first result is not missed.
app.ontoolresult = (result) => show(result as ToolResultLike);

app.onhostcontextchanged = (context) => {
  if (context.theme !== undefined) applyDocumentTheme(context.theme);
};

refresh.addEventListener('click', async () => {
  refresh.disabled = true;
  try {
    show((await app.callServerTool({ name: 'still_there_status', arguments: {} })) as ToolResultLike);
  } catch {
    root.insertAdjacentHTML('afterbegin', '<p class="error" role="alert">Couldn\'t reach StillThere just now.</p>');
  } finally {
    refresh.disabled = false;
  }
});

await app.connect();
const theme = app.getHostContext()?.theme;
if (theme !== undefined) applyDocumentTheme(theme);
