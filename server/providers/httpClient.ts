import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type {
  HttpTestErrorCategory,
  ProviderHttpTestResult,
  ProviderId,
} from '../../shared/contracts.ts';

export interface ProviderCallInput {
  providerId: ProviderId;
  apiKey: string;
  secondaryCredential?: string;
  keyId: string | null;
  keyLabel: string;
  keySource: 'vault' | 'env';
  model: string;
  prompt: string;
  timeoutMs?: number;
}

interface ProviderRequestSpec {
  requestUrl: string;
  displayEndpointUrl: string;
  headers: Record<string, string>;
  body: unknown;
  extractText: (data: unknown) => { ok: true; text: string } | { ok: false; reason: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;

const ALLOWED_PROVIDER_TARGETS: Record<
  ProviderId,
  { host: string; pathPrefix: string }
> = {
  gemini: {
    host: 'generativelanguage.googleapis.com',
    pathPrefix: '/v1beta/models/',
  },
  groq: {
    host: 'api.groq.com',
    pathPrefix: '/openai/v1/chat/completions',
  },
  cloudflare: {
    host: 'api.cloudflare.com',
    pathPrefix: '/client/v4/accounts/',
  },
  openrouter: {
    host: 'openrouter.ai',
    pathPrefix: '/api/v1/chat/completions',
  },
  mistral: {
    host: 'api.mistral.ai',
    pathPrefix: '/v1/chat/completions',
  },
};

export function isBlockedPrivateOrLoopbackIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (net.isIPv4(v4)) {
    const parts = v4.split('.').map(Number);
    if (parts.length !== 4) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export async function validateOutboundProviderTarget(
  providerId: ProviderId,
  requestUrl: string,
  options?: { checkDns?: boolean },
): Promise<void> {
  const policy = ALLOWED_PROVIDER_TARGETS[providerId];
  if (!policy) {
    throw new Error('Provedor sem destino de saída autorizado.');
  }

  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    throw new Error('URL de saída inválida.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Somente conexões HTTPS são permitidas para provedores externos.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credenciais embutidas na URL são proibidas.');
  }
  if (parsed.port !== '' && parsed.port !== '443') {
    throw new Error('Porta de destino não autorizada para chamadas de provedor.');
  }
  if (parsed.hostname.toLowerCase() !== policy.host) {
    throw new Error(
      `Destino ${parsed.hostname} bloqueado pela política de saída do provedor ${providerId}.`,
    );
  }
  if (!parsed.pathname.startsWith(policy.pathPrefix)) {
    throw new Error('Caminho de endpoint fora do escopo autorizado para o provedor.');
  }

  if (options?.checkDns) {
    const records = await dns.lookup(parsed.hostname, { all: true });
    if (records.length === 0) {
      throw new Error('Resolução DNS vazia para destino autorizado.');
    }
    for (const rec of records) {
      if (isBlockedPrivateOrLoopbackIp(rec.address)) {
        throw new Error('Destino resolveu para faixa IP privada/loopback bloqueada.');
      }
    }
  }
}

function sanitizeModelName(providerId: ProviderId, rawModel: string): string {
  const model = rawModel.trim();
  if (!/^[a-zA-Z0-9._:@/-]{3,120}$/.test(model) || model.includes('..')) {
    throw new Error('Nome de modelo inválido.');
  }
  if (providerId === 'cloudflare' && !model.startsWith('@cf/')) {
    throw new Error('Modelos Cloudflare Workers AI devem iniciar com @cf/.');
  }
  return model;
}

function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      clean = clean.split(secret).join('[REDACTED]');
    }
  }
  return clean;
}

function extractRateLimitHeaders(headers: Headers): Record<string, string> {
  const keys = [
    'retry-after',
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-tokens',
  ];
  const collected: Record<string, string> = {};
  for (const key of keys) {
    const val = headers.get(key);
    if (val) {
      collected[key] = val;
    }
  }
  return collected;
}

function extractOpenAICompatibleText(
  data: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'Payload JSON não é um objeto válido.' };
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, reason: 'Campo choices ausente ou vazio na resposta.' };
  }
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  const content = first?.message?.content ?? first?.text;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, reason: 'Conteúdo textual ausente em choices[0].' };
  }
  return { ok: true, text: content.trim() };
}

function extractGeminiText(
  data: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'Payload JSON do Gemini inválido.' };
  }
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, reason: 'Campo candidates ausente ou vazio na resposta do Gemini.' };
  }
  const first = candidates[0] as {
    content?: { parts?: Array<{ text?: unknown }> };
  };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) {
    return { ok: false, reason: 'Partes de conteúdo ausentes na resposta do Gemini.' };
  }
  const combined = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  if (!combined) {
    return { ok: false, reason: 'Nenhum texto retornado em candidates[0].content.parts.' };
  }
  return { ok: true, text: combined };
}

function extractCloudflareText(
  data: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'Payload JSON da Cloudflare inválido.' };
  }
  const obj = data as {
    success?: unknown;
    result?: { response?: unknown };
    errors?: Array<{ message?: unknown }>;
  };
  if (obj.success === false) {
    const msg = obj.errors?.[0]?.message;
    return {
      ok: false,
      reason: typeof msg === 'string' ? msg : 'Cloudflare retornou success=false.',
    };
  }
  const responseText = obj.result?.response;
  if (typeof responseText !== 'string' || responseText.trim().length === 0) {
    return { ok: false, reason: 'Campo result.response ausente na resposta da Cloudflare.' };
  }
  return { ok: true, text: responseText.trim() };
}

function buildProviderRequestSpec(input: ProviderCallInput): ProviderRequestSpec {
  const model = sanitizeModelName(input.providerId, input.model);
  const prompt = input.prompt.trim().slice(0, 400);

  switch (input.providerId) {
    case 'gemini': {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      return {
        requestUrl: url,
        displayEndpointUrl: url,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': input.apiKey,
        },
        body: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 64,
            temperature: 0,
          },
        },
        extractText: extractGeminiText,
      };
    }

    case 'groq': {
      const url = 'https://api.groq.com/openai/v1/chat/completions';
      return {
        requestUrl: url,
        displayEndpointUrl: url,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 64,
          temperature: 0,
        },
        extractText: extractOpenAICompatibleText,
      };
    }

    case 'cloudflare': {
      const accountId = input.secondaryCredential?.trim() ?? '';
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(accountId)) {
        throw new Error('Cloudflare Account ID inválido ou ausente.');
      }
      const maskedAccount = `••••${accountId.slice(-4)}`;
      return {
        requestUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
        displayEndpointUrl: `https://api.cloudflare.com/client/v4/accounts/${maskedAccount}/ai/run/${model}`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 64,
        },
        extractText: extractCloudflareText,
      };
    }

    case 'openrouter': {
      const appUrl =
        process.env.APP_URL && process.env.APP_URL.startsWith('http')
          ? process.env.APP_URL
          : 'http://localhost:3000';
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      return {
        requestUrl: url,
        displayEndpointUrl: url,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
          'HTTP-Referer': appUrl,
          'X-Title': 'AURIX AI',
        },
        body: {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 64,
          temperature: 0,
        },
        extractText: extractOpenAICompatibleText,
      };
    }

    case 'mistral': {
      const url = 'https://api.mistral.ai/v1/chat/completions';
      return {
        requestUrl: url,
        displayEndpointUrl: url,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 64,
          temperature: 0,
        },
        extractText: extractOpenAICompatibleText,
      };
    }
  }
}

function classifyHttpFailure(status: number): HttpTestErrorCategory {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limit';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'provider_error';
}

function extractProviderErrorMessage(parsed: unknown, rawText: string): string {
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as {
      error?: { message?: unknown } | string;
      message?: unknown;
      errors?: Array<{ message?: unknown }>;
    };
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
    if (obj.error && typeof obj.error === 'object' && typeof obj.error.message === 'string') {
      return obj.error.message.trim();
    }
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (Array.isArray(obj.errors) && typeof obj.errors[0]?.message === 'string') {
      return obj.errors[0].message.trim();
    }
  }
  return rawText.trim().slice(0, 280) || 'Resposta de erro sem detalhamento.';
}

export async function executeProviderHttpCall(
  input: ProviderCallInput,
  options?: { fetchFn?: typeof fetch },
): Promise<ProviderHttpTestResult> {
  const testId = `tst_${crypto.randomBytes(5).toString('hex')}`;
  const testedAt = new Date().toISOString();
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 2_000), 25_000);
  const fetchFn = options?.fetchFn ?? fetch;

  let spec: ProviderRequestSpec;
  try {
    spec = buildProviderRequestSpec(input);
    await validateOutboundProviderTarget(input.providerId, spec.requestUrl, {
      checkDns: !options?.fetchFn,
    });
  } catch (err) {
    return {
      id: testId,
      providerId: input.providerId,
      keyId: input.keyId,
      keyLabel: input.keyLabel,
      keySource: input.keySource,
      endpointUrl: 'configuração inválida',
      model: input.model,
      ok: false,
      httpStatus: null,
      httpStatusText: 'CLIENT_VALIDATION_ERROR',
      latencyMs: 0,
      errorCategory: 'bad_request',
      responsePreview: null,
      errorDetail: err instanceof Error ? err.message : 'Parâmetros inválidos.',
      rateLimitInfo: {},
      testedAt,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetchFn(spec.requestUrl, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      redirect: 'error',
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const rateLimitInfo = extractRateLimitHeaders(response.headers);
    const rawBody = await response.text();
    const safeRawBody = redactSecrets(rawBody, [input.apiKey, input.secondaryCredential]);

    let parsedJson: unknown = null;
    let jsonValid = false;
    try {
      parsedJson = JSON.parse(safeRawBody);
      jsonValid = true;
    } catch {
      jsonValid = false;
    }

    if (!response.ok) {
      const errorDetail = jsonValid
        ? extractProviderErrorMessage(parsedJson, safeRawBody)
        : safeRawBody.slice(0, 280) || `HTTP ${response.status} ${response.statusText}`;

      return {
        id: testId,
        providerId: input.providerId,
        keyId: input.keyId,
        keyLabel: input.keyLabel,
        keySource: input.keySource,
        endpointUrl: spec.displayEndpointUrl,
        model: input.model,
        ok: false,
        httpStatus: response.status,
        httpStatusText: response.statusText || String(response.status),
        latencyMs,
        errorCategory: classifyHttpFailure(response.status),
        responsePreview: null,
        errorDetail: redactSecrets(errorDetail, [input.apiKey, input.secondaryCredential]).slice(
          0,
          300,
        ),
        rateLimitInfo,
        testedAt,
      };
    }

    if (!jsonValid) {
      return {
        id: testId,
        providerId: input.providerId,
        keyId: input.keyId,
        keyLabel: input.keyLabel,
        keySource: input.keySource,
        endpointUrl: spec.displayEndpointUrl,
        model: input.model,
        ok: false,
        httpStatus: response.status,
        httpStatusText: response.statusText || String(response.status),
        latencyMs,
        errorCategory: 'invalid_response',
        responsePreview: null,
        errorDetail: `HTTP ${response.status}, porém o corpo não é JSON válido: ${safeRawBody.slice(0, 160)}`,
        rateLimitInfo,
        testedAt,
      };
    }

    const extracted = spec.extractText(parsedJson);
    if (!extracted.ok) {
      return {
        id: testId,
        providerId: input.providerId,
        keyId: input.keyId,
        keyLabel: input.keyLabel,
        keySource: input.keySource,
        endpointUrl: spec.displayEndpointUrl,
        model: input.model,
        ok: false,
        httpStatus: response.status,
        httpStatusText: response.statusText || String(response.status),
        latencyMs,
        errorCategory: 'invalid_response',
        responsePreview: null,
        errorDetail: extracted.reason,
        rateLimitInfo,
        testedAt,
      };
    }

    return {
      id: testId,
      providerId: input.providerId,
      keyId: input.keyId,
      keyLabel: input.keyLabel,
      keySource: input.keySource,
      endpointUrl: spec.displayEndpointUrl,
      model: input.model,
      ok: true,
      httpStatus: response.status,
      httpStatusText: response.statusText || 'OK',
      latencyMs,
      errorCategory: 'none',
      responsePreview: redactSecrets(extracted.text, [
        input.apiKey,
        input.secondaryCredential,
      ]).slice(0, 280),
      errorDetail: null,
      rateLimitInfo,
      testedAt,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const rawMsg = err instanceof Error ? err.message : 'Erro de rede desconhecido.';
    return {
      id: testId,
      providerId: input.providerId,
      keyId: input.keyId,
      keyLabel: input.keyLabel,
      keySource: input.keySource,
      endpointUrl: spec.displayEndpointUrl,
      model: input.model,
      ok: false,
      httpStatus: null,
      httpStatusText: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      latencyMs,
      errorCategory: isTimeout ? 'timeout' : 'network_error',
      responsePreview: null,
      errorDetail: isTimeout
        ? `Tempo limite excedido (${timeoutMs} ms) aguardando resposta do provedor.`
        : redactSecrets(rawMsg, [input.apiKey, input.secondaryCredential]),
      rateLimitInfo: {},
      testedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
