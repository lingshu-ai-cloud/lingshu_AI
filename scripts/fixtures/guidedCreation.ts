import { creationDialogueFixture } from './contentCreationDialogue.js';
import { contentCreationTurn } from '../../server/assistantContext/contentCreationDialogue.js';
import type { CreationSelection, CreationTurn } from '../../shared/contracts/contentCreationDialogue.js';
export function guidedCreationFixture() {
  const f = creationDialogueFixture();
  const originalAnalysis = JSON.parse(String(f.reference.aiAnalysis));
  const make = (id: string, materialTypes: string[]): Record<string, unknown> => ({ ...f.reference, id, title: `${id} OldProduct`, duration: materialTypes.length * 3, views: 12345,
    aiAnalysis: JSON.stringify({ ...originalAnalysis, contentSha256: 'a'.repeat(64), analysisQuality: 'video', gemini: { ...originalAnalysis.gemini, identityEntities: [{ type: 'product', text: 'OldProduct' }],
      audioTranscript: { segments: materialTypes.map((_, i) => ({ start: i * 3, end: (i + 1) * 3, text: i === 0 ? 'Meet OldProduct.' : 'Contact us for OEM.', timingPrecision: 'phrase', provenance: 'fixture_asr' })) },
      scriptDetails15s: materialTypes.map((type, i) => ({ shotId: `shot-${i + 1}`, time: `${i * 3}-${(i + 1) * 3}`, visual: type === 'factory' ? '工厂机器装配杯身' : '产品杯身正面', dialogue: i ? 'Contact us for OEM.' : 'Meet OldProduct.', materialType: type, narrativeRole: i ? 'cta' : 'hook', purpose: i ? 'OEM询盘行动引导' : '开场钩子', classificationEvidence: 'fixture reviewed', needsReview: false, confidence: .98 })),
    } }),
  });
  Object.assign(f.reference, make('fixture-video', ['product', 'product']));
  const recommended = make('recommended-video', ['product', 'factory', 'talking_head']);
  const foreign = { ...recommended, id: 'foreign-video', tenantId: 'other', views: 999999 };
  const records = [f.reference, recommended, foreign];
  f.ports.references = async () => records;
  f.ports.reference = async (tenant, id) => records.find(row => row.id === id && row.tenantId === tenant) || null;
  const run = (action: CreationTurn['action'], selection: CreationSelection) => contentCreationTurn('fixture', { action, selection, instruction: 'fixture planning only' }, f.ports);
  const initial: CreationSelection = { referenceId: 'fixture-video', productIds: [], shotIds: [], guided: { languages: [], customNodes: [], assignments: [] } };
  return { ...f, records, recommended, run, initial };
}
