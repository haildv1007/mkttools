import { prisma } from '../../utils/db';

export async function getOrgSetting(organizationId: string, key: string): Promise<string | null> {
  const row = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
  return row?.value ?? null;
}

export async function getOrgAiCredential(organizationId: string, provider: string): Promise<string | null> {
  const cred = await prisma.organizationAiCredential.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { apiKey: true, isActive: true },
  });
  if (!cred || !cred.isActive) return null;
  return cred.apiKey;
}

export async function getOrgAiOperationSetting(organizationId: string, operation: string): Promise<{ provider: string; model: string } | null> {
  const setting = await prisma.organizationAiOperationSetting.findUnique({
    where: { organizationId_operation: { organizationId, operation } },
  });
  if (!setting) return null;
  return { provider: setting.provider, model: setting.model };
}
