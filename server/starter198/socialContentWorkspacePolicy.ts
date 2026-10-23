import {socialJson,socialObject} from './socialContentValidation.js';

export const SOCIAL_OUTPUT_WORKSPACE_MANAGER='social_content_output';

export function isTrustedSocialOutputWorkspace(project:unknown):boolean {const row=socialObject(project),spec=socialObject(socialJson(row?.spec));return socialObject(spec?.automation)?.managedBy===SOCIAL_OUTPUT_WORKSPACE_MANAGER;}

export function socialOutputWorkspaceClientWriteBlocked(spec:unknown):boolean{const value=socialObject(socialJson(spec));return socialObject(value?.automation)?.managedBy===SOCIAL_OUTPUT_WORKSPACE_MANAGER||!!value?.socialProductionWorkspace;}
