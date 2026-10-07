import { GoogleGenAI, type Content } from '@google/genai';
import { normalizeVisualEvidence, type CaptionOccupancy, type EmphasisEvent, type ShotWindow, type VisualEvidence } from '../../shared/contracts/emphasisTimeline.js';

export const STUDIO_VISUAL_ANALYZER_VERSION = 'studio-visual-evidence.v2';

export type StudioVisualAnalyzerInput = {
  contactSheet: Buffer;
  shotWindows: ShotWindow[];
  contactFrames: Array<{ shotId: string; timeMs: number; column: number; row: number }>;
  captionOccupancy: CaptionOccupancy[];
  candidateEvents: Array<Pick<EmphasisEvent, 'id' | 'type' | 'startMs' | 'endMs' | 'text'>>;
};
export type StudioVisualAnalyzer = (input: StudioVisualAnalyzerInput) => Promise<unknown>;

const normalizedNumberJsonSchema = { type: 'number', minimum: 0, maximum: 1 } as const;
const normalizedBoxJsonSchema = {
  type: 'object',
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: normalizedNumberJsonSchema,
    y: normalizedNumberJsonSchema,
    width: normalizedNumberJsonSchema,
    height: normalizedNumberJsonSchema,
  },
} as const;

function unwrapVisualEvidence(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.shots)) return record.shots;
  if (Array.isArray(record.visualEvidence)) return record.visualEvidence;
  return [];
}

export function extractStudioVisualEvidenceJson(value: string): unknown[] {
  const content = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return unwrapVisualEvidence(JSON.parse(content)); } catch { return []; }
}

export async function defaultStudioVisualAnalyzer(input: StudioVisualAnalyzerInput): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return [];
  const prompt = `Analyze this single contact sheet as visual evidence only. Return exactly one JSON object with this top-level shape: {"shots":[...]}. Add one item to shots per visible shot.
Each shots item may contain only: shotId, subjectType(person|product|machine|process|unknown), subjectBox{x,y,width,height}, subjectAnchor{x,y}, safeZones[{x,y,width,height,clarity}], captionBoxes[{x,y,width,height}], confidence. Keep the response compact: at most one safe zone and one caption box per shot, and omit uncertain optional geometry.
Coordinates are normalized 0..1 within the original video frame, not the contact sheet. Do not create event text, prices, product claims, business facts, or final overlay coordinates. Omit uncertain boxes. confidence must reflect visible evidence.
Shot windows: ${JSON.stringify(input.shotWindows.slice(0, 24))}
Contact cells: ${JSON.stringify(input.contactFrames.slice(0, 18))}
Known caption occupancy: ${JSON.stringify(input.captionOccupancy.slice(0, 24))}
Candidate timing context only: ${JSON.stringify(input.candidateEvents.slice(0, 8))}`;
  const contents: Content[] = [{ role: 'user', parts: [
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: input.contactSheet.toString('base64') } },
  ] }];
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
    contents,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        required: ['shots'],
        properties: {
          shots: {
            type: 'array',
            items: {
              type: 'object',
              required: ['shotId', 'subjectType', 'confidence'],
              properties: {
                shotId: { type: 'string' },
                subjectType: { type: 'string', enum: ['person', 'product', 'machine', 'process', 'unknown'] },
                subjectBox: normalizedBoxJsonSchema,
                subjectAnchor: { type: 'object', required: ['x', 'y'], properties: {
                  x: normalizedNumberJsonSchema, y: normalizedNumberJsonSchema,
                } },
                safeZones: { type: 'array', items: { ...normalizedBoxJsonSchema, required: ['x', 'y', 'width', 'height', 'clarity'],
                  properties: { ...normalizedBoxJsonSchema.properties, clarity: normalizedNumberJsonSchema } } },
                captionBoxes: { type: 'array', items: normalizedBoxJsonSchema },
                confidence: normalizedNumberJsonSchema,
              },
            },
          },
        },
      },
      maxOutputTokens: 2_000,
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0,
    },
  });
  return extractStudioVisualEvidenceJson(response.text || '');
}

/** One contact sheet, one model request, strict local normalization. */
export async function analyzeStudioVisualEvidence(
  input: StudioVisualAnalyzerInput,
  options: { analyzer?: StudioVisualAnalyzer } = {},
): Promise<VisualEvidence[]> {
  if (!input.contactSheet?.length || !input.shotWindows.length) return [];
  try {
    const raw = unwrapVisualEvidence(await (options.analyzer || defaultStudioVisualAnalyzer)(input));
    const knownShots = new Set(input.shotWindows.map(shot => shot.id));
    return normalizeVisualEvidence(raw).filter(item => knownShots.has(item.shotId));
  } catch {
    return [];
  }
}
