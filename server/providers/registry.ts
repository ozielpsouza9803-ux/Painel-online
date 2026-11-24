import type { ProviderBlueprint, ProviderId } from '../../shared/contracts.ts';
import { countKeysByProvider } from '../security/vault.ts';

export interface AIProviderAdapterContract {
  readonly providerId: ProviderId;
  readonly stage: 'http_ready_stage_2';
  describeCapabilities(): string[];
}

const PROVIDER_DEFINITIONS: Omit<ProviderBlueprint, 'envConfigured' | 'registeredKeyCount'>[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    vendor: 'Google DeepMind',
    adapterStatus: 'http_ready_stage_2',
    freeTierSummary: 'Camada gratuita via Google AI Studio com limites diários de RPM/TPM.',
    capabilities: ['Texto & Raciocínio', 'Visão Multimodal', 'Function Calling', 'JSON Estruturado'],
    recommendedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    envVarName: 'GEMINI_API_KEY',
    endpointSummary: 'generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    requiredFields: [
      {
        key: 'apiKey',
        label: 'Gemini API Key',
        required: true,
        sensitive: true,
        placeholder: 'Informe sua chave obtida no Google AI Studio',
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    vendor: 'Groq',
    adapterStatus: 'http_ready_stage_2',
    freeTierSummary: 'Tier gratuito de baixa latência para modelos Llama e Mixtral.',
    capabilities: ['Inferência Ultrarrápida', 'Tool Use', 'Streaming SSE'],
    recommendedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    envVarName: 'GROQ_API_KEY',
    endpointSummary: 'api.groq.com/openai/v1/chat/completions',
    requiredFields: [
      {
        key: 'apiKey',
        label: 'Groq API Key',
        required: true,
        sensitive: true,
        placeholder: 'Informe sua chave do Groq Console',
      },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    vendor: 'Cloudflare',
    adapterStatus: 'http_ready_stage_2',
    freeTierSummary: 'Cota gratuita diária de Neurons no plano Workers Free.',
    capabilities: ['Edge Inference', 'Embeddings', 'Classificação Rápida'],
    recommendedModels: ['@cf/meta/llama-3.1-8b-instruct', '@cf/baai/bge-m3'],
    envVarName: 'CLOUDFLARE_API_TOKEN',
    endpointSummary: 'api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}',
    requiredFields: [
      {
        key: 'apiKey',
        label: 'Cloudflare API Token',
        required: true,
        sensitive: true,
        placeholder: 'Token com permissão Workers AI Read/Run',
      },
      {
        key: 'secondaryCredential',
        label: 'Cloudflare Account ID',
        required: true,
        sensitive: true,
        placeholder: 'ID da conta Cloudflare',
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    vendor: 'OpenRouter',
    adapterStatus: 'http_ready_stage_2',
    freeTierSummary: 'Roteamento unificado com modelos comunitários gratuitos (:free).',
    capabilities: ['Gateway Multimodelo', 'Fallback de Roteamento', 'JSON Mode'],
    recommendedModels: ['meta-llama/llama-3.3-70b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
    envVarName: 'OPENROUTER_API_KEY',
    endpointSummary: 'openrouter.ai/api/v1/chat/completions',
    requiredFields: [
      {
        key: 'apiKey',
        label: 'OpenRouter API Key',
        required: true,
        sensitive: true,
        placeholder: 'Informe sua chave da OpenRouter',
      },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    vendor: 'Mistral AI',
    adapterStatus: 'http_ready_stage_2',
    freeTierSummary: 'Tier experimental La Plateforme com limites gratuitos por minuto.',
    capabilities: ['Function Calling', 'Código & Texto Multilíngue', 'Saída Estruturada'],
    recommendedModels: ['mistral-small-latest', 'codestral-latest'],
    envVarName: 'MISTRAL_API_KEY',
    endpointSummary: 'api.mistral.ai/v1/chat/completions',
    requiredFields: [
      {
        key: 'apiKey',
        label: 'Mistral API Key',
        required: true,
        sensitive: true,
        placeholder: 'Informe sua chave da La Plateforme',
      },
    ],
  },
];

function isRealEnvConfigured(envVarName: string): boolean {
  const val = process.env[envVarName]?.trim();
  if (!val || val.length < 10) return false;
  if (val.startsWith('MY_') || val === 'undefined' || val === 'null') return false;
  return true;
}

export function getProviderDefinition(
  providerId: string,
): Omit<ProviderBlueprint, 'envConfigured' | 'registeredKeyCount'> | null {
  return PROVIDER_DEFINITIONS.find((d) => d.id === providerId) ?? null;
}

export function getEnvCredentialsForProvider(providerId: ProviderId): {
  apiKey: string;
  secondaryCredential?: string;
} | null {
  const def = getProviderDefinition(providerId);
  if (!def || !isRealEnvConfigured(def.envVarName)) {
    return null;
  }
  const apiKey = process.env[def.envVarName]!.trim();
  if (providerId === 'cloudflare') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!accountId || accountId.length < 8) {
      return null;
    }
    return { apiKey, secondaryCredential: accountId };
  }
  return { apiKey };
}

export function listProviderBlueprints(): ProviderBlueprint[] {
  const counts = countKeysByProvider();
  return PROVIDER_DEFINITIONS.map((def) => ({
    ...def,
    envConfigured: isRealEnvConfigured(def.envVarName),
    registeredKeyCount: counts[def.id] ?? 0,
  }));
}
