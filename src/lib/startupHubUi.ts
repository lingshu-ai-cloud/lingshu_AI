import type { StartupCompanyDocument, StartupCompanyDocumentCategory, StartupCompanyProfile, StartupHubCreateInput, StartupHubRecordKind, StartupLeadChatImport } from '../../shared/startupHub';

export interface StartupHubActions {
  updateCompany(input: Omit<StartupCompanyProfile, 'updatedAt' | 'updatedBy'>): Promise<void>;
  create<K extends StartupHubRecordKind>(kind: K, input: StartupHubCreateInput<K>): Promise<void>;
  update<K extends StartupHubRecordKind>(kind: K, id: string, patch: Partial<StartupHubCreateInput<K>>): Promise<void>;
  acknowledgeAnnouncement(id: string): Promise<void>;
  uploadDocument(file: File, metadata: { category: StartupCompanyDocumentCategory; expiryDate?: string }): Promise<void>;
  downloadDocument(document: StartupCompanyDocument): Promise<void>;
  loadDocumentBlob(document: StartupCompanyDocument): Promise<Blob>;
  deleteDocument(id: string): Promise<void>;
  uploadLeadChat(file: File, leadId: string): Promise<void>;
  downloadLeadChat(chatImport: StartupLeadChatImport): Promise<void>;
  deleteLeadChat(id: string): Promise<void>;
}
