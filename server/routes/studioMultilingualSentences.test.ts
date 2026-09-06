import assert from 'node:assert/strict';
import { splitStudioNarrationSentences } from './studio.js';
const es=['¿Quieres ver la placa?','En la parte trasera puedes ver las pistas.','En el frente puedes ver los componentes.','¿Qué prefieres ver primero?'];
assert.deepEqual(splitStudioNarrationSentences(es.join('\n')),es,'Spanish final CTA must retain its own audio/scene boundary');
assert.deepEqual(splitStudioNarrationSentences('Observa la placa. ¡Mira las pistas!'),['Observa la placa.','¡Mira las pistas!']);
assert.deepEqual(splitStudioNarrationSentences('Look at the 3.5 mm detail. What do you see?'),['Look at the 3.5 mm detail.','What do you see?']);
assert.deepEqual(splitStudioNarrationSentences('看看背面。再看看正面？'),['看看背面。','再看看正面？']);
console.log('Multilingual sentence-to-audio scene boundaries passed');
