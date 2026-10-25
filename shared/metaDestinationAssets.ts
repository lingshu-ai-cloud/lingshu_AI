export type MetaDestinationKind = 'forms' | 'messages' | 'pixels';
export interface MetaDestinationAssets {
  kind: MetaDestinationKind;
  pageId: string;
  forms: Array<{ id: string; name: string; locale: string; questions: string[] }>;
  termsAccepted: boolean | null;
  pixels: Array<{ id: string; name: string }>;
  whatsappPhoneNumber: string;
  instagram: { id: string; username: string } | null;
}
