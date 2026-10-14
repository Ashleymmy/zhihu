/** Reserved platform contract. No provider, route, document collection or UI is enabled. */
export type IdentityVerificationStatus = 'not_submitted' | 'pending' | 'verified' | 'rejected';
export interface IdentityVerificationProvider {
  readonly providerId: string;
  // Future integrations must return only a provider reference and masked result;
  // raw identity documents must not enter user profiles, audit logs or tokens.
  getStatus(reference: string): Promise<{ status: IdentityVerificationStatus; verifiedAt?: string }>;
}
export const identityVerificationEnabled = false as const;
