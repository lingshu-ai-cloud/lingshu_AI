import { type Material } from '../routes/studioMaterialProjection.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';


export function loadMaterials(): Material[] { return readLocalMaterials() as Material[]; }

export function persistMaterials(list: Material[]): void { saveLocalMaterials(list); }
