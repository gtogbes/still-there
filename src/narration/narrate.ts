import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { buildUserPrompt, SYSTEM_PROMPT, type NarrationRequest } from './prompt.js';
import { fallbackNarration, validateNarration } from './validate.js';

/**
 * Turns verified findings into one short message, using Bedrock.
 *
 * The shape of this function is the point. It never fails, never throws, and never
 * blocks a notification: every path — model denied, model slow, model unavailable,
 * model output rejected by the validator — returns the deterministic text instead.
 *
 * So the model is an enhancement layered on something already correct, rather than a
 * dependency the product needs in order to work. A family still gets told their
 * mother has not been up, in accurate and specific language, on a day when Bedrock is
 * having an outage or nobody has enabled model access yet.
 */

export type NarrationSource = 'model' | 'fallback';

export interface Narration {
  readonly text: string;
  readonly source: NarrationSource;
  /** Why the model's output was not used. Logged, never shown to a user. */
  readonly rejection?: string;
  readonly modelId?: string;
  readonly latencyMs?: number;
}

/** Well under the assessment's own timeout. A slow model must not delay an alert. */
const TIMEOUT_MS = 8_000;

let client: BedrockRuntimeClient | undefined;

export interface NarrateOptions {
  readonly modelId?: string;
  readonly region?: string;
}

export async function narrate(
  request: NarrationRequest,
  options: NarrateOptions = {},
): Promise<Narration> {
  const fallback = fallbackNarration(request.findings);

  if (request.findings.length === 0) {
    return { text: '', source: 'fallback' };
  }

  const modelId = options.modelId ?? process.env['NARRATION_MODEL_ID'];
  if (modelId === undefined || modelId === '') {
    return { text: fallback, source: 'fallback', rejection: 'no model configured' };
  }

  const startedAt = Date.now();

  try {
    client ??= new BedrockRuntimeClient({
      ...(options.region === undefined ? {} : { region: options.region }),
    });

    const messages: Message[] = [
      { role: 'user', content: [{ text: buildUserPrompt(request) }] },
    ];

    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        inferenceConfig: {
          // Low but not zero. This is a writing task where a little variation reads
          // more naturally than a template, and the validator catches anything the
          // variation drags out of bounds.
          temperature: 0.3,
          maxTokens: 220,
        },
      }),
      { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    const latencyMs = Date.now() - startedAt;

    const text = (response.output?.message?.content ?? [])
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();

    const verdict = validateNarration(text, request.findings);
    if (!verdict.acceptable) {
      // Deliberately logged as a warning rather than swallowed. A rising rate here
      // means the prompt or the model has drifted, and the only visible symptom
      // would otherwise be notifications quietly getting blunter.
      return {
        text: fallback,
        source: 'fallback',
        ...(verdict.rejection === undefined ? {} : { rejection: verdict.rejection }),
        modelId,
        latencyMs,
      };
    }

    return { text, source: 'model', modelId, latencyMs };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    return {
      text: fallback,
      source: 'fallback',
      rejection: `bedrock error: ${name}`,
      modelId,
      latencyMs: Date.now() - startedAt,
    };
  }
}
