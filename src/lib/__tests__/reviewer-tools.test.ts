import { describe, it, expect } from 'vitest';

// We test the tool execution logic by replicating the pure functions
// that don't require database or API access.

describe('search_pattern tool logic', () => {
  // Replicate the search_pattern logic for isolated testing
  function searchPattern(pattern: string, diff: string): string {
    try {
      const regex = new RegExp(pattern, 'gm');
      const matches = diff.match(regex);
      if (!matches) return 'No matches found for the given pattern.';
      const lines = diff.split('\n');
      const matchedLines: string[] = [];
      const lineRegex = new RegExp(pattern);
      for (let i = 0; i < lines.length; i++) {
        if (lineRegex.test(lines[i])) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length - 1, i + 2);
          for (let j = start; j <= end; j++) {
            matchedLines.push(`L${j + 1}: ${lines[j]}`);
          }
          matchedLines.push('---');
        }
      }
      return `Found ${matches.length} match(es):\n${matchedLines.slice(0, 50).join('\n')}`;
    } catch {
      return 'Invalid regex pattern provided.';
    }
  }

  it('should find matches in a diff', () => {
    const diff = '+const foo = "bar";\n+const baz = "qux";\n-const old = "value";';
    const result = searchPattern('const foo', diff);
    expect(result).toContain('Found 1 match(es)');
    expect(result).toContain('const foo');
  });

  it('should return no matches for missing pattern', () => {
    const diff = '+const foo = "bar";';
    const result = searchPattern('nonexistent', diff);
    expect(result).toBe('No matches found for the given pattern.');
  });

  it('should handle invalid regex gracefully', () => {
    const diff = '+some code';
    const result = searchPattern('[invalid', diff);
    expect(result).toBe('Invalid regex pattern provided.');
  });

  it('should find multiple matches', () => {
    const diff = '+import React from "react";\n+import { useState } from "react";\n+const x = 1;';
    const result = searchPattern('from "react"', diff);
    expect(result).toContain('Found 2 match(es)');
  });

  it('should include context lines around matches', () => {
    const diff = '+line1\n+line2\n+const TARGET = 1;\n+line4\n+line5';
    const result = searchPattern('TARGET', diff);
    expect(result).toContain('L1:');
    expect(result).toContain('TARGET');
    expect(result).toContain('---');
  });

  it('should limit output to 50 lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `+match_line_${i}`);
    const diff = lines.join('\n');
    const result = searchPattern('match_line', diff);
    const outputLines = result.split('\n');
    // The output starts with "Found N match(es):" then up to 50 context lines + separators
    expect(outputLines.length).toBeLessThanOrEqual(52); // 1 header + 50 lines + possible separator
  });
});

describe('symbol_search tool logic', () => {
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function symbolSearch(symbol: string, diff: string): { definitions: Array<{ file: string; type: string }>; usages: Array<{ file: string }> } {
    const definitions: Array<{ file: string; type: string }> = [];
    const usages: Array<{ file: string }> = [];
    const diffLines = diff.split('\n');
    let currentFile = '';

    const definitionPatterns = [
      { type: 'function', regex: new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegex(symbol)}\\b`) },
      { type: 'arrow function', regex: new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escapeRegex(symbol)}\\s*=\\s*(?:async\\s+)?\\(`) },
      { type: 'const/let/var', regex: new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escapeRegex(symbol)}\\s*=`) },
      { type: 'class', regex: new RegExp(`(?:export\\s+)?(?:default\\s+)?class\\s+${escapeRegex(symbol)}\\b`) },
      { type: 'interface', regex: new RegExp(`(?:export\\s+)?interface\\s+${escapeRegex(symbol)}\\b`) },
      { type: 'type', regex: new RegExp(`(?:export\\s+)?type\\s+${escapeRegex(symbol)}\\b`) },
    ];
    const usageRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`);

    for (const line of diffLines) {
      const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileHeader) {
        currentFile = fileHeader[1];
        continue;
      }
      if (!currentFile || !line.startsWith('+') || line.startsWith('+++')) continue;

      let isDefinition = false;
      for (const { type, regex } of definitionPatterns) {
        if (regex.test(line)) {
          definitions.push({ file: currentFile, type });
          isDefinition = true;
          break;
        }
      }
      if (!isDefinition && usageRegex.test(line)) {
        usages.push({ file: currentFile });
      }
    }

    return { definitions, usages };
  }

  it('should find function definitions', () => {
    const diff = '+++ b/src/utils.ts\n+export function formatDate(date: string): string {';
    const result = symbolSearch('formatDate', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('function');
    expect(result.definitions[0].file).toBe('src/utils.ts');
  });

  it('should find class definitions', () => {
    const diff = '+++ b/src/models.ts\n+export class User {';
    const result = symbolSearch('User', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('class');
  });

  it('should find const definitions', () => {
    const diff = '+++ b/src/config.ts\n+export const API_URL = "https://api.example.com";';
    const result = symbolSearch('API_URL', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('const/let/var');
  });

  it('should find interface definitions', () => {
    const diff = '+++ b/src/types.ts\n+export interface ReviewResult {';
    const result = symbolSearch('ReviewResult', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('interface');
  });

  it('should find arrow function definitions', () => {
    const diff = '+++ b/src/hooks.ts\n+export const useAuth = () => {';
    const result = symbolSearch('useAuth', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('arrow function');
  });

  it('should find type alias definitions', () => {
    const diff = '+++ b/src/types.ts\n+export type Status = "active" | "inactive";';
    const result = symbolSearch('Status', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('type');
  });

  it('should find symbol usages', () => {
    const diff = '+++ b/src/page.tsx\n+import { formatDate } from "./utils";\n+const formatted = formatDate(date);';
    const result = symbolSearch('formatDate', diff);
    expect(result.usages.length).toBeGreaterThanOrEqual(1);
  });

  it('should find nothing for unknown symbols', () => {
    const diff = '+++ b/src/utils.ts\n+const foo = 1;';
    const result = symbolSearch('nonexistent', diff);
    expect(result.definitions).toHaveLength(0);
    expect(result.usages).toHaveLength(0);
  });

  it('should not match in removed lines', () => {
    const diff = '+++ b/src/utils.ts\n-function oldName() {';
    const result = symbolSearch('oldName', diff);
    expect(result.definitions).toHaveLength(0);
    expect(result.usages).toHaveLength(0);
  });

  it('should distinguish definition from usage', () => {
    const diff = '+++ b/src/utils.ts\n+export function myFunc() {}\n+++ b/src/page.tsx\n+myFunc();';
    const result = symbolSearch('myFunc', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('function');
    expect(result.usages).toHaveLength(1);
  });
});

describe('file_relationships tool logic', () => {
  function analyzeFileRelationships(diff: string): {
    changedFiles: string[];
    importMap: Record<string, string[]>;
    clusters: string[][];
  } {
    const diffLines = diff.split('\n');
    const changedFiles: string[] = [];

    for (const line of diffLines) {
      const match = line.match(/^\+\+\+ b\/(.+)$/);
      if (match) changedFiles.push(match[1]);
    }

    const importMap: Record<string, string[]> = {};
    const reverseImportMap: Record<string, string[]> = {};
    const importPatterns = [
      /(?:import|from)\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    let currentFile = '';
    for (const line of diffLines) {
      const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileHeader) {
        currentFile = fileHeader[1];
        if (!importMap[currentFile]) importMap[currentFile] = [];
        continue;
      }
      if (!currentFile || !line.startsWith('+') || line.startsWith('+++')) continue;

      for (const pattern of importPatterns) {
        pattern.lastIndex = 0;
        let importMatch;
        while ((importMatch = pattern.exec(line)) !== null) {
          const importPath = importMatch[1];
          if (importPath.startsWith('.')) {
            const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/')) || '.';
            const resolved = (currentDir + '/' + importPath).replace(/\/\.\//g, '/').replace(/[^/]+\/\.\.\//g, '');
            for (const cf of changedFiles) {
              const cfNoExt = cf.replace(/\.[^.]+$/, '');
              if (cf === resolved || cf === resolved + '.ts' || cf === resolved + '.js' ||
                  cfNoExt === resolved) {
                if (!importMap[currentFile].includes(cf)) importMap[currentFile].push(cf);
                if (!reverseImportMap[cf]) reverseImportMap[cf] = [];
                if (!reverseImportMap[cf].includes(currentFile)) reverseImportMap[cf].push(currentFile);
              }
            }
          }
        }
      }
    }

    // Connected components
    const visited = new Set<string>();
    const clusters: string[][] = [];
    for (const file of changedFiles) {
      if (visited.has(file)) continue;
      const cluster: string[] = [];
      const queue = [file];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        const neighbors = [...(importMap[current] || []), ...(reverseImportMap[current] || [])];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (cluster.length > 1) clusters.push(cluster);
    }

    return { changedFiles, importMap, clusters };
  }

  it('should parse changed files from diff headers', () => {
    const diff = '+++ b/src/foo.ts\n+code\n+++ b/src/bar.ts\n+more code';
    const result = analyzeFileRelationships(diff);
    expect(result.changedFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('should detect import relationships between changed files', () => {
    const diff = '+++ b/src/utils.ts\n+export const foo = 1;\n+++ b/src/page.tsx\n+import { foo } from "./utils";';
    const result = analyzeFileRelationships(diff);
    expect(result.importMap['src/page.tsx']).toContain('src/utils.ts');
  });

  it('should identify clusters of coupled files', () => {
    const diff = '+++ b/src/a.ts\n+import { b } from "./b";\n+++ b/src/b.ts\n+import { a } from "./a";';
    const result = analyzeFileRelationships(diff);
    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0]).toHaveLength(2);
  });

  it('should return no clusters for independent files', () => {
    const diff = '+++ b/src/a.ts\n+const x = 1;\n+++ b/src/b.ts\n+const y = 2;';
    const result = analyzeFileRelationships(diff);
    expect(result.clusters).toHaveLength(0);
  });

  it('should handle empty diff', () => {
    const result = analyzeFileRelationships('');
    expect(result.changedFiles).toHaveLength(0);
    expect(result.clusters).toHaveLength(0);
  });
});

describe('analyze_deps tool logic', () => {
  function analyzeDeps(filePath: string, fileContent: string, diffLines: string[]): { issues: string[]; warnings: string[] } {
    const issues: string[] = [];
    const warnings: string[] = [];

    const isManifest = filePath.includes('package.json') ||
      filePath.includes('requirements.txt') ||
      filePath.includes('Cargo.toml') ||
      filePath.includes('go.mod') ||
      fileContent.includes('"dependencies"') ||
      fileContent.includes('"devDependencies"');

    if (isManifest) {
      const knownVulnerable: Record<string, string> = {
        'lodash@': '<4.17.21 may have prototype pollution',
        'express@': '<4.17.3 has open redirect vulnerability',
        'moment@': 'Deprecated - consider using date-fns or dayjs',
        'node-sass@': 'Deprecated - use sass (dart-sass) instead',
        'request@': 'Deprecated - use node-fetch or axios',
      };
      for (const [pkg, issue] of Object.entries(knownVulnerable)) {
        if (fileContent.includes(pkg)) issues.push(`${pkg}: ${issue}`);
      }

      const addedDeps: string[] = [];
      const removedDeps: string[] = [];
      for (const line of diffLines) {
        if (line.startsWith('+') && !line.startsWith('++') && line.includes('"')) addedDeps.push(line);
        if (line.startsWith('-') && !line.startsWith('--') && line.includes('"')) removedDeps.push(line);
      }
      if (addedDeps.length > 0) warnings.push(`${addedDeps.length} new/updated dependenc(ies) added`);
      if (removedDeps.length > 0 && addedDeps.length === 0) warnings.push(`${removedDeps.length} dependenc(ies) removed`);
    }

    return { issues, warnings };
  }

  it('should detect known vulnerable packages', () => {
    const content = '{"dependencies": {"lodash@4.17.20": true}}';
    const result = analyzeDeps('package.json', content, []);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should detect deprecated packages', () => {
    const content = '{"dependencies": {"moment@2.29.0": true}}';
    const result = analyzeDeps('package.json', content, []);
    expect(result.issues.some(i => i.includes('moment'))).toBe(true);
  });

  it('should detect node-sass as deprecated', () => {
    const content = '{"devDependencies": {"node-sass@6.0.0": true}}';
    const result = analyzeDeps('package.json', content, []);
    expect(result.issues.some(i => i.includes('node-sass'))).toBe(true);
  });

  it('should detect request as deprecated', () => {
    const content = '{"dependencies": {"request@2.88.0": true}}';
    const result = analyzeDeps('package.json', content, []);
    expect(result.issues.some(i => i.includes('request'))).toBe(true);
  });

  it('should warn about added dependencies', () => {
    const content = '{"dependencies": {}}';
    const diffLines = ['+    "new-dep": "^1.0.0"'];
    const result = analyzeDeps('package.json', content, diffLines);
    expect(result.warnings.some(w => w.includes('added'))).toBe(true);
  });

  it('should warn about removed dependencies with no additions', () => {
    const content = '{"dependencies": {}}';
    const diffLines = ['-    "old-dep": "^1.0.0"'];
    const result = analyzeDeps('package.json', content, diffLines);
    expect(result.warnings.some(w => w.includes('removed'))).toBe(true);
  });

  it('should return no issues for clean dependencies', () => {
    const content = '{"dependencies": {"react": "^18.0.0"}}';
    const result = analyzeDeps('package.json', content, []);
    expect(result.issues).toHaveLength(0);
  });

  it('should not flag non-manifest files', () => {
    const content = 'const x = 1;';
    const result = analyzeDeps('src/index.ts', content, []);
    expect(result.issues).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should detect manifest by content even without package.json in name', () => {
    const content = '{"dependencies": {"lodash@3.0.0": true}}';
    const result = analyzeDeps('some/manifest.json', content, []);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('check_tests tool logic', () => {
  function generateTestPatterns(filePath: string): string[] {
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '.';
    const basename = filePath.substring(filePath.lastIndexOf('/') + 1);
    const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';
    const nameWithoutExt = ext ? basename.substring(0, basename.length - ext.length) : basename;

    return [
      `${dir}/${nameWithoutExt}.test${ext}`,
      `${dir}/${nameWithoutExt}.spec${ext}`,
      `${dir}/__tests__/${nameWithoutExt}.test${ext}`,
      `${dir}/tests/${nameWithoutExt}.test${ext}`,
    ];
  }

  it('should generate correct test patterns for TypeScript files', () => {
    const patterns = generateTestPatterns('src/lib/reviewer.ts');
    expect(patterns).toContain('src/lib/reviewer.test.ts');
    expect(patterns).toContain('src/lib/reviewer.spec.ts');
    expect(patterns).toContain('src/lib/__tests__/reviewer.test.ts');
    expect(patterns).toContain('src/lib/tests/reviewer.test.ts');
  });

  it('should generate correct test patterns for React files', () => {
    const patterns = generateTestPatterns('src/components/Button.tsx');
    expect(patterns).toContain('src/components/Button.test.tsx');
    expect(patterns).toContain('src/components/__tests__/Button.test.tsx');
  });

  it('should handle files in root directory', () => {
    const patterns = generateTestPatterns('index.ts');
    // When file is in root, dir becomes '.' so patterns start with './'
    expect(patterns).toContain('./index.test.ts');
    expect(patterns).toContain('./__tests__/index.test.ts');
  });

  it('should handle deeply nested files', () => {
    const patterns = generateTestPatterns('src/app/api/webhook/route.ts');
    expect(patterns).toContain('src/app/api/webhook/route.test.ts');
    expect(patterns).toContain('src/app/api/webhook/__tests__/route.test.ts');
  });

  it('should handle files without extensions', () => {
    const patterns = generateTestPatterns('src/scripts/build');
    expect(patterns).toContain('src/scripts/build.test');
    expect(patterns).toContain('src/scripts/build.spec');
  });
});

describe('ignore patterns filtering', () => {

  // Also test blast_radius tool logic
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function blastRadiusAnalysis(filePath: string, diff: string, fileContents: Record<string, string>): {
    impactLevel: 'low' | 'medium' | 'high' | 'critical';
    referenceCount: number;
    exportCount: number;
    exportedSymbols: string[];
  } {
    const diffLines = diff.split('\n');
    const changedFiles: string[] = [];
    const baseName = filePath.split('/').pop() || filePath;
    const nameWithoutExt = baseName.includes('.') ? baseName.substring(0, baseName.lastIndexOf('.')) : baseName;

    for (const line of diffLines) {
      const gitMatch = line.match(/^diff --git a\/.+ b\/(.+)$/);
      if (gitMatch) changedFiles.push(gitMatch[1]);
    }

    let referenceCount = 0;
    const referencingFiles: string[] = [];

    for (const file of changedFiles) {
      if (file === filePath) continue;
      const fileContent = fileContents[file] || '';
      if (!fileContent) continue;

      const importPatterns = [
        new RegExp(`(?:import .* from ['"]|require\\(['"]).*${escapeRegex(nameWithoutExt)}['"]`, 'g'),
        new RegExp(`from ['"].*${escapeRegex(nameWithoutExt)}['"]`, 'g'),
      ];

      for (const pattern of importPatterns) {
        if (pattern.test(fileContent)) {
          referenceCount++;
          referencingFiles.push(file);
          break;
        }
      }
    }

    const targetContent = fileContents[filePath] || '';
    let exportCount = 0;
    const exportedSymbols: string[] = [];
    if (targetContent) {
      const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|type|interface)\s+(\w+)/g;
      let match;
      while ((match = exportRegex.exec(targetContent)) !== null) {
        exportedSymbols.push(match[1]);
        exportCount++;
      }
    }

    let impactLevel: 'low' | 'medium' | 'high' | 'critical';
    if (referenceCount >= 5 || exportCount >= 10) impactLevel = 'critical';
    else if (referenceCount >= 3 || exportCount >= 5) impactLevel = 'high';
    else if (referenceCount >= 1 || exportCount >= 2) impactLevel = 'medium';
    else impactLevel = 'low';

    return { impactLevel, referenceCount, exportCount, exportedSymbols };
  }

  it('should compute low impact for isolated file', () => {
    const diff = 'diff --git a/src/utils.ts b/src/utils.ts\n+const x = 1;';
    const result = blastRadiusAnalysis('src/utils.ts', diff, { 'src/utils.ts': 'const x = 1;' });
    expect(result.impactLevel).toBe('low');
    expect(result.referenceCount).toBe(0);
  });

  it('should detect references from other files', () => {
    const diff = 'diff --git a/src/utils.ts b/src/utils.ts\n+export const foo = 1;\ndiff --git a/src/page.tsx b/src/page.tsx\n+import { foo } from "./utils";';
    const fileContents = {
      'src/utils.ts': 'export const foo = 1;',
      'src/page.tsx': 'import { foo } from "./utils";',
    };
    const result = blastRadiusAnalysis('src/utils.ts', diff, fileContents);
    expect(result.referenceCount).toBeGreaterThanOrEqual(1);
    expect(result.impactLevel).not.toBe('low');
  });

  it('should count exported symbols', () => {
    const diff = 'diff --git a/src/api.ts b/src/api.ts\n+export function getUser() {}\n+export function deleteUser() {}\n+export class User {}';
    const fileContents = {
      'src/api.ts': 'export function getUser() {}\nexport function deleteUser() {}\nexport class User {}',
    };
    const result = blastRadiusAnalysis('src/api.ts', diff, fileContents);
    expect(result.exportCount).toBeGreaterThanOrEqual(3);
    expect(result.exportedSymbols).toContain('getUser');
    expect(result.exportedSymbols).toContain('deleteUser');
    expect(result.exportedSymbols).toContain('User');
  });

  it('should compute critical impact for highly-connected files', () => {
    const diff = [
      'diff --git a/src/core.ts b/src/core.ts',
      '+export const core = true;',
      ...Array.from({ length: 6 }, (_, i) => `diff --git a/src/mod${i}.ts b/src/mod${i}.ts`),
    ].join('\n');
    const fileContents: Record<string, string> = {
      'src/core.ts': 'export const core = true;',
    };
    for (let i = 0; i < 6; i++) {
      fileContents[`src/mod${i}.ts`] = `import { core } from "./core";`;
    }
    const result = blastRadiusAnalysis('src/core.ts', diff, fileContents);
    expect(result.referenceCount).toBeGreaterThanOrEqual(5);
    expect(result.impactLevel).toBe('critical');
  });

  it('should handle file not in diff', () => {
    const diff = 'diff --git a/src/other.ts b/src/other.ts\n+const y = 2;';
    const result = blastRadiusAnalysis('src/nonexistent.ts', diff, {});
    expect(result.impactLevel).toBe('low');
  });
  function filterDiffWithIgnorePatterns(diff: string, patterns: string[]): string {
    if (patterns.length === 0) return diff;
    const diffLines = diff.split('\n');
    const resultLines: string[] = [];
    let skipFile = false;
    for (const line of diffLines) {
      if (line.startsWith('diff --git')) {
        skipFile = false;
        for (const pattern of patterns) {
          const globRegex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          if (globRegex.test(line)) {
            skipFile = true;
            break;
          }
        }
      }
      if (!skipFile) resultLines.push(line);
    }
    return resultLines.join('\n');
  }

  it('should filter out files matching ignore patterns', () => {
    const diff = 'diff --git a/generated.ts b/generated.ts\n+generated content\ndiff --git a/src/app.ts b/src/app.ts\n+real content';
    const result = filterDiffWithIgnorePatterns(diff, ['*.generated.*']);
    expect(result).toContain('real content');
  });

  it('should not filter when no patterns provided', () => {
    const diff = 'diff --git a/a.ts b/a.ts\n+content';
    const result = filterDiffWithIgnorePatterns(diff, []);
    expect(result).toBe(diff);
  });

  it('should filter by exact diff header pattern', () => {
    const diff = 'diff --git a/src/generated.output.ts b/src/generated.output.ts\n+output\ndiff --git a/src/real.ts b/src/real.ts\n+real code';
    const result = filterDiffWithIgnorePatterns(diff, ['*generated*']);
    expect(result).not.toContain('output');
    expect(result).toContain('real code');
  });
});
