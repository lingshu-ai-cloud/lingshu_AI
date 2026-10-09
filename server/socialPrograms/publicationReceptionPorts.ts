import { readTenantEnterpriseFacts } from '../routes/enterprise.js';
import { readCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';
import type { ReceptionCheckPorts } from './publicationReceptionReadiness.js';
import { createReceptionPublicUrlProbe } from './publicationReceptionUrlProbe.js';

/** Real enterprise/channel readers and pinned public URL probes; owner directory is supplied explicitly. */
export function createPublicationReceptionPorts(input: {
  ownerExists: ReceptionCheckPorts['ownerExists'];
  probePublicUrl?: ReceptionCheckPorts['probePublicUrl'];
}): ReceptionCheckPorts {
  return {
    async facts(tenantId) {
      const facts = await readTenantEnterpriseFacts(tenantId);
      return {
        contentHash: facts.version.contentHash,
        revision: facts.version.revision,
        documentUrls: (facts.profile.products.items ?? []).flatMap(product => (product.documents ?? []).flatMap(document => document.url ? [document.url] : [])),
      };
    },
    messaging: readCustomerMessagingAuthorization,
    ownerExists: input.ownerExists,
    probePublicUrl: input.probePublicUrl ?? createReceptionPublicUrlProbe(),
  };
}
