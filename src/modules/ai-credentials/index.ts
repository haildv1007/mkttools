import { Router, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthRequest } from '../../middleware/auth';
import { encryptSecret, decryptSecret, maskSecret } from '../../utils/crypto';
import { roleAtLeast, OrgRole } from '../organization';
import { PROVIDER_MODELS, providerSupports, Operation } from './provider-models';

export type CredentialSource = 'ORGANIZATION_KEY' | 'PERSONAL_KEY' | 'PLATFORM_API';
export const ENABLED_SOURCES: CredentialSource[] = ['ORGANIZATION_KEY'];

export const SUPPORTED_PROVIDERS = ['gemini', 'openai', 'claude'] as const;
export type ProviderName = typeof SUPPORTED_PROVIDERS[number];

/** Operations the customer configures directly. Revision operations always
 *  inherit their generation counterpart's setting (see resolveGeneration). */
export const EDITABLE_OPERATIONS: Operation[] = ['TEXT_GENERATION', 'IMAGE_GENERATION', 'VIDEO_GENERATION'];

export interface ResolvedCredential {
  source: CredentialSource;
  provider: string;
  apiKey: string;
  /** Optional provider-level fallback model, only used when the operation
   *  has no explicit model configured. Never overrides an operation setting. */
  defaultModel: string | null;
  config: Record<string, unknown> | null;
}

export class AiProviderNotConfiguredError extends Error {
  status = 400 as const;
  code = 'AI_PROVIDER_NOT_CONFIGURED' as const;
  constructor(public provider: string) {
    super(`Organization chưa cấu hình AI cho ${provider}.`);
  }
}

/** Credential row exists but its encrypted API key can no longer be
 *  decrypted (e.g. AI_CREDENTIAL_KEY changed on the server). Distinct from
 *  "not configured" so the UI can tell the customer to re-enter the key
 *  instead of silently looking unconfigured. */
export class AiCredentialInvalidError extends Error {
  status = 400 as const;
  code = 'AI_CREDENTIAL_INVALID' as const;
  constructor(public provider: string) {
    super(`API key của ${provider} không đọc được. Vui lòng nhập lại API key.`);
  }
}

export class AiModelNotAvailableError extends Error {
  status = 400 as const;
  code = 'AI_MODEL_NOT_AVAILABLE' as const;
  constructor(msg = 'Model không khả dụng cho provider này.') { super(msg); }
}

/** Provider is configured and reachable, but no explicit model was ever
 *  selected for this operation. BYOK: we never guess a model on the
 *  customer's behalf - this must be surfaced, not silently resolved. */
export class AiModelNotConfiguredError extends Error {
  status = 400 as const;
  code = 'AI_MODEL_NOT_CONFIGURED' as const;
  constructor(msg = 'Chưa cấu hình model.') { super(msg); }
}

/**
 * Resolve the credential a generation call should use for this org+provider.
 * Credentials are strictly organization-scoped - there is no cross-org or
 * platform-global fallback, and a new organization never inherits another
 * organization's key.
 */
export async function resolveCredential(args: { organizationId: string; provider: string; actorUserId?: string }): Promise<ResolvedCredential> {
  const { organizationId, provider } = args;
  const providerLower = provider.toLowerCase();
  const existing = await prisma.organizationAiCredential.findUnique({
    where: { organizationId_provider: { organizationId, provider: providerLower } },
  });
  if (!existing?.isActive || !existing.encryptedApiKey) {
    throw new AiProviderNotConfiguredError(providerLower);
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(existing.encryptedApiKey);
  } catch {
    throw new AiCredentialInvalidError(providerLower);
  }
  return {
    source: existing.source as CredentialSource,
    provider: providerLower,
    apiKey,
    defaultModel: existing.defaultModel,
    config: (existing.config as Record<string, unknown> | null) ?? null,
  };
}

/** Non-throwing variant: for provider `testConnection` and non-critical UI probes. */
export async function tryResolveCredential(args: { organizationId: string; provider: string }): Promise<ResolvedCredential | null> {
  try { return await resolveCredential(args); } catch { return null; }
}

/** Safe credential status for UI display - never throws, never exposes the
 *  key or ciphertext. */
export type CredentialStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'DECRYPT_ERROR';
export async function credentialStatus(args: { organizationId: string; provider: string }): Promise<CredentialStatus> {
  const row = await prisma.organizationAiCredential.findUnique({
    where: { organizationId_provider: { organizationId: args.organizationId, provider: args.provider.toLowerCase() } },
  });
  if (!row?.isActive || !row.encryptedApiKey) return 'NOT_CONFIGURED';
  try { decryptSecret(row.encryptedApiKey); return 'CONFIGURED'; } catch { return 'DECRYPT_ERROR'; }
}

// ---------------- Model resolver ----------------

export { PROVIDER_MODELS, providerSupports, recommendedModels } from './provider-models';
export type { Operation } from './provider-models';

export interface ResolvedGeneration {
  provider: string;
  operation: Operation;
  model: string;
  apiKey: string;
}

/**
 * Single source of truth for "what do we actually call the provider with".
 * BYOK: the customer explicitly picks provider + model; there is no
 * quality-tier system and generation never guesses a model on its behalf.
 *
 * Priority (per operation):
 *   1. Explicit override passed by the caller (rare - e.g. an internal test
 *      tool asking for a specific provider/model).
 *   2. The organization's OrganizationAiOperationSetting for this operation
 *      (TEXT_REVISION inherits TEXT_GENERATION's setting, IMAGE_REVISION
 *      inherits IMAGE_GENERATION's - customers don't configure revision
 *      separately).
 *   3. The provider credential's defaultModel, if the customer set one, as
 *      a provider-level fallback only (it never overrides an operation
 *      setting that already names a model).
 *
 * If no model is resolved by that point, this throws
 * AiModelNotConfiguredError rather than picking one - an explicitly
 * selected model is never silently swapped for another.
 */
export async function resolveGeneration(args: {
  organizationId: string;
  operation: Operation;
  explicitProvider?: string | null;
  explicitModel?: string | null;
  actorUserId?: string;
}): Promise<ResolvedGeneration> {
  const { organizationId, operation } = args;
  const settingOperation: Operation =
    operation === 'TEXT_REVISION' ? 'TEXT_GENERATION' :
    operation === 'IMAGE_REVISION' ? 'IMAGE_GENERATION' :
    operation;

  let provider = args.explicitProvider?.toLowerCase() || null;
  let model = args.explicitModel || null;

  let opSetting: { provider: string; model: string } | null = null;
  if (!provider || !model) {
    const row = await prisma.organizationAiOperationSetting.findUnique({
      where: { organizationId_operation: { organizationId, operation: settingOperation } },
    });
    if (row) opSetting = { provider: row.provider, model: row.model };
  }
  if (!provider) provider = opSetting?.provider || null;
  if (!provider) throw new AiProviderNotConfiguredError(operation);
  if (!providerSupports(provider, operation)) {
    throw new AiModelNotAvailableError(`${provider} không hỗ trợ ${operation}.`);
  }

  const cred = await resolveCredential({ organizationId, provider, actorUserId: args.actorUserId });

  if (!model && opSetting && opSetting.provider === provider) model = opSetting.model;
  if (!model && cred.defaultModel) model = cred.defaultModel;
  if (!model) throw new AiModelNotConfiguredError(`Chưa cấu hình model cho ${provider}/${operation}.`);

  return { provider, operation, model, apiKey: cred.apiKey };
}

function serialize(row: any) {
  let maskedKey = '';
  let status: CredentialStatus = 'NOT_CONFIGURED';
  if (row.encryptedApiKey) {
    try {
      maskedKey = maskSecret(decryptSecret(row.encryptedApiKey));
      status = 'CONFIGURED';
    } catch {
      status = 'DECRYPT_ERROR';
    }
  }
  return {
    id: row.id,
    provider: row.provider,
    source: row.source,
    defaultModel: row.defaultModel,
    config: row.config,
    isActive: row.isActive,
    status,
    validationStatus: row.validationStatus,
    validationMessage: row.validationMessage,
    lastValidatedAt: row.lastValidatedAt,
    updatedAt: row.updatedAt,
    maskedKey,
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
  const { apiKey, defaultModel, config, source } = req.body || {};
  const wantedSource: CredentialSource = source && ENABLED_SOURCES.includes(source) ? source : 'ORGANIZATION_KEY';
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 6) {
    return res.status(400).json({ error: 'INVALID_KEY', message: 'API key không hợp lệ.' });
  }
  // BYOK: defaultModel is a free-form provider model id, not restricted to
  // the recommended catalog - the customer pays the provider directly and
  // may use any model their key supports. It is only a provider-level
  // fallback and never overrides an operation's explicit model.
  const enc = encryptSecret(apiKey.trim());
  const row = await prisma.organizationAiCredential.upsert({
    where: { organizationId_provider: { organizationId: req.organizationId!, provider } },
    update: {
      encryptedApiKey: enc, defaultModel: defaultModel || null,
      config: config ?? undefined, source: wantedSource, isActive: true,
      validationStatus: 'UNTESTED', validationMessage: null, lastValidatedAt: null,
    },
    create: {
      organizationId: req.organizationId!, provider,
      encryptedApiKey: enc, defaultModel: defaultModel || null,
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
  if (!cred) {
    const cs = await credentialStatus({ organizationId: req.organizationId!, provider });
    if (cs === 'DECRYPT_ERROR') {
      return res.status(400).json({ status: 'INVALID', code: 'AI_CREDENTIAL_INVALID', message: 'Không đọc được API key đã lưu. Vui lòng nhập lại.' });
    }
    return res.status(400).json({ status: 'INVALID', code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'Chưa có API key.' });
  }
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

// ---------------- Per-operation provider/model settings ----------------
// Canonical customer-facing AI configuration: which provider+model backs
// each operation. TEXT_REVISION/IMAGE_REVISION are not directly editable -
// they always inherit TEXT_GENERATION/IMAGE_GENERATION (see resolveGeneration).

router.get('/operations', async (req: AuthRequest, res: Response) => {
  const rows = await prisma.organizationAiOperationSetting.findMany({
    where: { organizationId: req.organizationId },
  });
  res.json({
    editableOperations: EDITABLE_OPERATIONS,
    operations: rows.map((r) => ({ operation: r.operation, provider: r.provider, model: r.model, updatedAt: r.updatedAt })),
  });
});

router.put('/operations/:operation', async (req: AuthRequest, res: Response) => {
  if (!requireOrgAdmin(req.organizationRole)) return res.status(403).json({ error: 'FORBIDDEN' });
  const operation = String(req.params.operation).toUpperCase() as Operation;
  if (!EDITABLE_OPERATIONS.includes(operation)) {
    return res.status(400).json({ error: 'INVALID_OPERATION', message: `${operation} không thể cấu hình trực tiếp.` });
  }
  const { provider, model } = req.body || {};
  if (!provider || typeof provider !== 'string' || !SUPPORTED_PROVIDERS.includes(provider.toLowerCase() as ProviderName)) {
    return res.status(400).json({ error: 'UNSUPPORTED_PROVIDER' });
  }
  const providerLower = provider.toLowerCase();
  if (!providerSupports(providerLower, operation)) {
    return res.status(400).json({ error: 'AI_MODEL_NOT_AVAILABLE', message: `${providerLower} không hỗ trợ ${operation}.` });
  }
  if (!model || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'INVALID_MODEL', message: 'Vui lòng nhập Model ID.' });
  }
  const row = await prisma.organizationAiOperationSetting.upsert({
    where: { organizationId_operation: { organizationId: req.organizationId!, operation } },
    update: { provider: providerLower, model: model.trim() },
    create: { organizationId: req.organizationId!, operation, provider: providerLower, model: model.trim() },
  });
  res.json({ operation: row.operation, provider: row.provider, model: row.model, updatedAt: row.updatedAt });
});

export { router as aiCredentialRouter };
