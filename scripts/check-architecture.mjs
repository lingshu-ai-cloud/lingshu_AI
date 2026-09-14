import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repositoryRoot, 'architecture.config.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));

const normalizedPath = value => value.split(path.sep).join('/');
const isSourceFile = file => config.extensions.some(extension => file.endsWith(extension));
const isExcluded = file => config.excludeNameFragments.some(fragment => file.includes(fragment));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && isSourceFile(entry.name) && !isExcluded(entry.name)) files.push(absolute);
  }
  return files;
}

function lineCount(source) {
  if (!source) return 0;
  return source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
}

function importSpecifiers(source) {
  const specifiers = [];
  const matcher = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(matcher)) specifiers.push(match[1]);
  return specifiers;
}

function boundaryViolations(relative, source) {
  const violations = [];
  const imports = importSpecifiers(source);
  const pointsOutsideShared = specifier => /(?:^|\/)server(?:\/|$)|(?:^|\/)src(?:\/|$)/.test(specifier);
  const importsRoutes = specifier => /(?:^|\/)routes(?:\/|$)/.test(specifier);
  const importsServer = specifier => /(?:^|\/)server(?:\/|$)/.test(specifier);

  if (relative.startsWith('shared/') && imports.some(pointsOutsideShared)) {
    violations.push('shared/ must remain independent from src/ and server/');
  }
  if (relative.startsWith('server/modules/') && imports.some(importsRoutes)) {
    violations.push('server/modules/ cannot import HTTP route adapters');
  }
  if (relative.startsWith('server/starter198/') && imports.some(importsRoutes)) {
    violations.push('server/starter198/ cannot import legacy HTTP route adapters');
  }
  if (relative.startsWith('src/features/') && imports.some(importsServer)) {
    violations.push('src/features/ cannot import server implementation modules');
  }
  return violations;
}

const files = (await Promise.all(config.sourceRoots.map(root => walk(path.join(repositoryRoot, root))))).flat();
const failures = [];
const oversized = [];
const linesByFile = new Map();

const baselineRef = String(process.env.ARCHITECTURE_BASE_REF || '').trim();
let ratchetMessage = 'Architecture budget ratchet skipped (ARCHITECTURE_BASE_REF is not set).';
if (baselineRef) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(baselineRef)) {
    failures.push('ARCHITECTURE_BASE_REF contains unsupported characters');
  } else {
    try {
      execFileSync('git', ['cat-file', '-e', `${baselineRef}^{commit}`], {
        cwd: repositoryRoot,
        stdio: 'ignore',
      });
      let baselineConfigExists = true;
      try {
        execFileSync('git', ['cat-file', '-e', `${baselineRef}:architecture.config.json`], {
          cwd: repositoryRoot,
          stdio: 'ignore',
        });
      } catch {
        baselineConfigExists = false;
      }
      if (!baselineConfigExists) {
        ratchetMessage = `Architecture budget ratchet has no baseline config at ${baselineRef}; this is allowed only for the guard's first introduction.`;
      } else {
        try {
          const baselineConfig = JSON.parse(execFileSync(
            'git',
            ['show', `${baselineRef}:architecture.config.json`],
            { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ));
          if (config.defaultMaxLines > baselineConfig.defaultMaxLines) {
            failures.push(`defaultMaxLines increased from ${baselineConfig.defaultMaxLines} to ${config.defaultMaxLines}`);
          }
          for (const root of baselineConfig.sourceRoots || []) {
            if (!config.sourceRoots.includes(root)) failures.push(`source root removed from architecture guard: ${root}`);
          }
          for (const extension of baselineConfig.extensions || []) {
            if (!config.extensions.includes(extension)) failures.push(`source extension removed from architecture guard: ${extension}`);
          }
          for (const fragment of config.excludeNameFragments || []) {
            if (!(baselineConfig.excludeNameFragments || []).includes(fragment)) {
              failures.push(`new architecture exclusion requires an explicit guard-policy review: ${fragment}`);
            }
          }
          for (const [relative, currentBudget] of Object.entries(config.oversizedFileBudgets || {})) {
            const previousBudget = baselineConfig.oversizedFileBudgets?.[relative];
            if (previousBudget === undefined && currentBudget > baselineConfig.defaultMaxLines) {
              failures.push(`${relative}: new oversized-file exception ${currentBudget} exceeds the baseline default`);
            } else if (previousBudget !== undefined && currentBudget > previousBudget) {
              failures.push(`${relative}: budget increased from ${previousBudget} to ${currentBudget}`);
            }
          }
          ratchetMessage = `Architecture budget ratchet checked against ${baselineRef}.`;
        } catch {
          failures.push(`unable to read a valid architecture baseline config from ${baselineRef}`);
        }
      }
    } catch {
      failures.push(`ARCHITECTURE_BASE_REF does not resolve to a commit: ${baselineRef}`);
    }
  }
}

for (const absolute of files) {
  const relative = normalizedPath(path.relative(repositoryRoot, absolute));
  const source = await readFile(absolute, 'utf8');
  const lines = lineCount(source);
  linesByFile.set(relative, lines);
  const budget = config.oversizedFileBudgets[relative] ?? config.defaultMaxLines;
  if (lines > config.defaultMaxLines) oversized.push({ relative, lines, budget });
  if (lines > budget) failures.push(`${relative}: ${lines} lines exceeds its ${budget}-line budget`);
  for (const message of boundaryViolations(relative, source)) failures.push(`${relative}: ${message}`);
}

for (const relative of Object.keys(config.oversizedFileBudgets)) {
  if (!linesByFile.has(relative)) {
    failures.push(`${relative}: stale oversized-file exception; remove it from architecture.config.json`);
  } else if (linesByFile.get(relative) <= config.defaultMaxLines) {
    failures.push(`${relative}: now fits the default budget; remove its exception from architecture.config.json`);
  }
}

if (failures.length) {
  console.error('Architecture guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture guard passed for ${files.length} production TypeScript files.`);
  console.log(`${oversized.length} legacy oversized files are frozen at or below their recorded budgets; new files are capped at ${config.defaultMaxLines} lines.`);
  console.log(ratchetMessage);
}
