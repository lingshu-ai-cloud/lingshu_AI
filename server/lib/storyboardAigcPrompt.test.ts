import assert from 'node:assert/strict';
import { buildStoryboardFirstFramePrompt, buildStoryboardVideoActionPrompt } from './storyboardAigcPrompt.js';
import { compileStoryboardShotSpec } from '../../shared/storyboardShotSpec.js';

const base = {
  mode: 'replication' as const,
  sceneType: 'usage' as const,
  shotDescription: '在副驾驶涂抹防晒霜',
  productName: '企业防晒霜',
  hasSourceFrame: true,
  hasProductImage: true,
  hasCharacterImage: false,
  ratio: '9:16',
};

const prompt = buildStoryboardFirstFramePrompt(base);
assert.match(prompt, /source shot's actual first frame/);
assert.match(prompt, /ONLY for camera angle/);
assert.match(prompt, /enterprise knowledge-base product/);
assert.match(prompt, /show only repeated instances of that same enterprise product/);
assert.match(prompt, /stable START state/);
assert.doesNotMatch(prompt, /specified enterprise person's identity/);

const factory = buildStoryboardFirstFramePrompt({ ...base, mode: 'free_creation', sceneType: 'factory', hasSourceFrame: false, hasProductImage: false, productName: '' });
assert.match(factory, /factory filming setup/);
assert.doesNotMatch(factory, /source shot's actual first frame/);
const general = buildStoryboardFirstFramePrompt({ ...base, mode: 'free_creation', sceneType: 'general', shotDescription: '人物走过走廊', hasSourceFrame: false, hasProductImage: false, productName: '' });
assert.match(general, /No enterprise product is assigned/);
assert.doesNotMatch(general, /Target enterprise product:/);
const multiProduct = buildStoryboardFirstFramePrompt({ ...base, productNames: ['吊灯 A', '吊灯 B'], productImageCount: 2, hasCharacterImage: false });
assert.match(multiProduct, /Reference image 2 is enterprise knowledge-base product "吊灯 A"/);
assert.match(multiProduct, /Reference image 3 is enterprise knowledge-base product "吊灯 B"/);
const sheetPrompt = buildStoryboardFirstFramePrompt({ ...base, productNames: ['吊灯 A', '吊灯 B'],
  productImageCount: 2, hasCharacterImage: true, productReferenceMode: 'contact_sheet' });
assert.match(sheetPrompt, /Reference image 2 is a contact sheet/);
assert.match(sheetPrompt, /1: "吊灯 A"; 2: "吊灯 B"/);
assert.match(sheetPrompt, /Reference image 3 defines the specified enterprise person's identity/);
const environmentPrompt = buildStoryboardFirstFramePrompt({ ...base, hasEnvironmentImage: true });
assert.match(environmentPrompt, /Reference image 3 is the selected project environment image/);
assert.match(environmentPrompt, /does not prove factory ownership/);
const compositePrompt = buildStoryboardFirstFramePrompt({ ...base, sceneType: 'factory', hasCharacterImage: true,
  hasEnvironmentImage: true, personEnvironmentReferenceMode: 'contact_sheet' });
assert.match(compositePrompt, /Reference image 3 is a two-panel contact sheet/);
assert.match(compositePrompt, /LEFT is the specified enterprise person's identity, RIGHT is the selected enterprise environment image/);
assert.doesNotMatch(compositePrompt, /Reference image 4/);
const multiViewPrompt = buildStoryboardFirstFramePrompt({ ...base, productReferenceMode: 'multi_view_sheet', productViewCount: 3 });
assert.match(multiViewPrompt, /3-panel sheet of DIFFERENT VIEWS OF THE SAME/);
assert.match(multiViewPrompt, /do not treat panels as multiple products/);
assert.doesNotMatch(multiViewPrompt, /Reference image 3 is enterprise knowledge-base product/);
const oneViewSpec = compileStoryboardShotSpec({ shotId: 'single-view', mode: 'free_creation', scene: 'product',
  description: '桌面产品轻微运镜', ratio: '9:16', assets: [{ role: 'product', id: 'product-a',
    version: 'v1', source: 'knowledge_base' }] });
assert.match(buildStoryboardFirstFramePrompt({ ...base, spec: oneViewSpec }), /do not invent unseen sides/);
assert.match(buildStoryboardVideoActionPrompt(oneViewSpec), /Do not reveal an unseen back or side/);
