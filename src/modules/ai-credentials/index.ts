import { Router, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';
import { encryptSecret, decryptSecret, maskSecret } from '../../utils/crypto';
import { roleAtLeast, OrgRole } from '../organization';
import { getSetting } from '../settings';
import { PROVIDER_MODELS, QUALITY_TIERS, providerSupports, providerSupportsModel, AiModelNotSupportedError, Operation, Quality } from './provider-models';

export type CredentialSource = 'ORGANIZATION_KEY' | 'PERSONAL_KEY' | 'PLATFORM_API';
export const ENABLED_SOURCES: CredentialSource[] = ['ORGANIZATION_KEY'];

export const SUPPORTED_PROVIDERS = ['gemini', 'openai', 'claude'] as const;
export type ProviderName = typeof SUPPORTED_PROVIDERS[number];

// Legacy app_settings key names, per provider — used for one-time backfill.
const LEGACY_KEY: Record<ProviderName, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
};

export interface ResolvedCredential {
  source: CredentialSource;
  provider: string;
  apiKey: string;
  defaultModel: string | null;
  config: Record<string, unknown> | null;
}

export class AiProviderNotConfiguredError extends Error {
  status = 400 as const;
  code = 'AI_PROVIDER_NOT_CONFIGURED' as const;
  constructor(public provider: string) {
    super(`Organization chưa cấu hình API ${provider}.`);
  }
}

/**
 * Resolve the credential a generation call should use for this org+provider.
 * V1 only enables ORGANIZATION_KEY. If no organization credential exists,
 * transparently migrate a legacy app_setting value into an encrypted org
 * credential on first use so existing installs keep working.
 */
export async function resolveCredential(args: { organizationId: string; provider: string; actorUserId?: string }): Promise<ResolvedCredential> {
  const { organizationId, provider } = args;
  const providerLower = provider.toLowerCase();
  const existing = await prisma.organizationAiCredential.findUnique({
    where: { organizationId_provider: { organizationId, provider: providerLower } },
  });
  if (existing?.isActive && existing.encryptedApiKey) {
    return {
      source: existing.source as CredentialSource,
      provider: providerLower,
      apiKey: decryptSecret(existing.encryptedApiKey),
      defaultModel: existing.defaultModel,
      config: (existing.config as Record<string, unknown> | null) ?? null,
    };
  }
  // First-run migration: if the legacy app_settings key holds a value, adopt it
  // for this organization on the fly (encrypted).
  const legacyName = LEGACY_KEY[providerLower as ProviderName];
  if (legacyName) {
    const legacy = await getSetting(legacyName);
    if (legacy) {
      const enc = encryptSecret(legacy);
      const created = await prisma.organizationAiCredential.upsert({
        where: { organizationId_provider: { organizationId, provider: providerLower } },
        update: { encryptedApiKey: enc, isActive: true, source: 'ORGANIZATION_KEY' },
        create: {
          organizationId, provider: providerLower, encryptedApiKey: enc,
          source: 'ORGANIZATION_KEY', validationStatus: 'UNTESTED',
        },
      });
      return {
        source: created.source as CredentialSource,
        provider: providerLower,
        apiKey: legacy,
        defaultModel: created.defaultModel,
        config: (created.config as Record<string, unknown> | null) ?? null,
      };
    }
  }
  throw new AiProviderNotConfiguredError(providerLower);
}

/** Non-throwing variant: for provider `testConnection` and non-critical UI probes. */
export async function tryResolveCredential(args: { organizationId: string; provider: string }): Promise<ResolvedCredential | null> {
  try { return await resolveCredential(args); } catch { return null; }
}

// ---------------- Model resolver ----------------

export { AiModelNotSupportedError, PROVIDER_MODELS, QUALITY_TIERS } from './provider-models';
export type { Operation, Quality } from './provider-models';

export interface ResolvedModel {
  provider: string;
  operation: Operation;
  quality: Quality;
  model: string;
}

/**
 * Central model resolution. Given (org, provider, operation, quality?),
 * returns the concrete provider model id to call. Falls back to:
 *   explicit quality -> org default quality -> BALANCED -> first tier available.
 * Throws AiModelNotSupportedError if the provider does not support the
 * operation, or if an explicit model id was passed for a provider that
 * does not list it in the catalog.
 */
export async function resolveModel(args: {
  organizationId: string;
  provider: string;
  operation: Operation;
  qualityTier?: Quality | null;
  explicitModel?: string | null;
}): Promise<ResolvedModel> {
  const provider = args.provider.toLowerCase();
  const table = PROVIDER_MODELS[provider];
  if (!table || !table[args.operation]) {
    throw new AiModelNotSupportedError(`Provider ${provider} không hỗ trợ operation ${args.operation}.`);
  }
  const opTable = table[args.operation]!;

  if (args.explicitModel) {
    if (!providerSupportsModel(provider, args.explicitModel)) {
      throw new AiModelNotSupportedError(`Model ${args.explicitModel} không được ${provider} hỗ trợ.`);
    }
    // Find quality mapping (best-effort) for reporting only.
    const q = (QUALITY_TIERS.find((q) => opTable[q] === args.explicitModel) as Quality) || 'BALANCED';
    return { provider, operation: args.operation, quality: q, model: args.explicitModel };
  }

  let quality: Quality | undefined = args.qualityTier || undefined;
  if (!quality) {
    // Load org default quality from the stored credential row.
    const cred = await prisma.organizationAiCredential.findUnique({
      where: { organizationId_provider: { organizationId: args.organizationId, provider } },
      select: { defaultQuality: true },
    });
    quality = (cred?.defaultQuality as Quality | null) || 'BALANCED';
  }

  // Fall back to first available tier if requested tier is unsupported for op.
  let model = opTable[quality];
  if (!model) {
    for (const q of QUALITY_TIERS) {
      if (opTable[q]) { quality = q; model = opTable[q]!; break; }
    }
  }
  if (!model) throw new AiModelNotSupportedError(`Không tìm được model phù hợp cho ${provider}/${args.operation}.`);
  return { provider, operation: args.operation, quality, model };
}

function serialize(row: any) {
  return {
    id: row.id,
    provider: row.provider,
    source: row.source,
    defaultModel: row.defaultModel,
    defaultQuality: row.defaultQuality,
    config: row.config,
    isActive: row.isActive,
    validationStatus: row.validationStatus,
    validationMessage: row.validationMessage,
    lastValidatedAt: row.lastValidatedAt,
    updatedAt: row.updatedAt,
    maskedKey: maskSecret(decryptSecret(row.encryptedApiKey || '')),
    hasKey: !!row.encryptedApiKey,
    supportedOperations: Object.keys(PROVIDER_MODELS[row.provider] || {}),
  };
}

// ---------------- Routes ----------------
const router = Router();

function requireOrgAdmin(role: OrgRole | undefined): boolean {
  return roleAtLeast(role, 'ADMIN');
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const creds = await prisma.organizationAiCredential.findMany({
    where: { organizationId: req.organizationId },
    orderBy: { provider: 'asc' },
  });
  // OWNER/ADMIN can see credentials; MANAGER/MEMBER see only booleans (no maskedKey either)
  const providerCatalog = SUPPORTED_PROVIDERS.map((p) => ({
    provider: p,
    operations: PROVIDER_MODELS[p] || {},
    qualityTiers: QUALITY_TIERS,
  }));
  if (requireOrgAdmin(req.organizationRole)) {
    res.json({ enabledSources: ENABLED_SOURCES, supportedProviders: SUPPORTED_PROVIDERS, providerCatalog, credentials: creds.map(serialize) });
  } else {
    res.json({
      enabledSources: ENABLED_SOURCES,
      supportedProviders: SUPPORTED_PROVIDERS,
      providerCatalog,
      credentials: creds.map((c) => ({ provider: c.provider, isActive: c.isActive, hasKey: !!c.encryptedApiKey })),
    });
  }
});

router.put('/:provider', async (req: AuthRequest, res: Response) => {
  if (!requireOrgAdmin(req.organizationRole)) return res.status(403).json({ error: 'FORBIDDEN' });
  const provider = String(req.params.provider).toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider as ProviderName)) return res.status(400).json({ error: 'UNSUPPORTED_PROVIDER' });
  const { apiKey, defaultModel, defaultQuality, config, source } = req.body || {};
  const wantedSource: CredentialSource = source && ENABLED_SOURCES.includes(source) ? source : 'ORGANIZATION_KEY';
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 6) {
    return res.status(400).json({ error: 'INVALID_KEY', message: 'API key không hợp lệ.' });
  }
  // Validate defaultModel / defaultQuality against catalog for this provider.
  if (defaultModel && !providerSupportsModel(provider, defaultModel)) {
    return res.status(400).json({ error: 'AI_MODEL_NOT_SUPPORTED', message: `Model ${defaultModel} không được ${provider} hỗ trợ.` });
  }
  const wantedQuality = defaultQuality && QUALITY_TIERS.includes(defaultQuality) ? defaultQuality : null;
  const enc = encryptSecret(apiKey.trim());
  const row = await prisma.organizationAiCredential.upsert({
    where: { organizationId_provider: { organizationId: req.organizationId!, provider } },
    update: {
      encryptedApiKey: enc, defaultModel: defaultModel || null, defaultQuality: wantedQuality,
      config: config ?? undefined, source: wantedSource, isActive: true,
      validationStatus: 'UNTESTED', validationMessage: null, lastValidatedAt: null,
    },
    create: {
      organizationId: req.organizationId!, provider,
      encryptedApiKey: enc, defaultModel: defaultModel || null, defaultQuality: wantedQuality,
      config: config ?? undefined, source: wantedSource, isActive: true,
    },
  });
  res.json(serialize(row));
});

router.delete('/:provider', async (req: AuthRequest, res: Response) => {
  if (!requireOrgAdmin(req.organizationRole)) return res.status(403).json({ error: 'FORBIDDEN' });
  const provider = String(req.params.provider).toLowerCase();
  await prisma.organizationAiCredential.deleteMany({
    where: { organizationId: req.organizationId, provider },
  });
  res.json({ success: true });
});

router.post('/:provider/test', async (req: AuthRequest, res: Response) => {
  if (!requireOrgAdmin(req.organizationRole)) return res.status(403).json({ error: 'FORBIDDEN' });
  const provider = String(req.params.provider).toLowerCase();
  const cred = await tryResolveCredential({ organizationId: req.organizationId!, provider });
  if (!cred) return res.status(400).json({ status: 'INVALID', message: 'Chưa có API key.' });
  let status: 'CONNECTED' | 'INVALID' | 'ERROR' = 'ERROR';
  let message = '';
  try {
    if (provider === 'gemini') {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cred.apiKey)}`);
      status = r.ok ? 'CONNECTED' : (r.status === 401 || r.status === 403 ? 'INVALID' : 'ERROR');
      if (!r.ok) message = `Provider trả về mã ${r.status}.`;
    } else if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${cred.apiKey}` } });
      status = r.ok ? 'CONNECTED' : (r.status === 401 || r.status === 403 ? 'INVALID' : 'ERROR');
      if (!r.ok) message = `Provider trả về mã ${r.status}.`;
    } else if (provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': cred.apiKey, 'anthropic-version': '2023-06-01' },
      });
      status = r.ok ? 'CONNECTED' : (r.status === 401 || r.status === 403 ? 'INVALID' : 'ERROR');
      if (!r.ok) message = `Provider trả về mã ${r.status}.`;
    }
  } catch (e) {
    status = 'ERROR';
    message = 'Không thể kết nối provider.';
  }
  await prisma.organizationAiCredential.updateMany({
    where: { organizationId: req.organizationId, provider },
    data: { validationStatus: status, validationMessage: message || null, lastValidatedAt: new Date() },
  });
  res.json({ status, message: status === 'CONNECTED' ? 'Kết nối thành công.' : (message || 'Không kết nối được.') });
});

export { router as aiCredentialRouter };
