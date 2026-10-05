export function assertQueueOrganization(resourceOrganizationId: string, payloadOrganizationId?: string): void {
  if (payloadOrganizationId && payloadOrganizationId !== resourceOrganizationId) {
    throw new Error('Queue organization mismatch');
  }
}
