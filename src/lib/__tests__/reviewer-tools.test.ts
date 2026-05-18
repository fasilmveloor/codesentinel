import { describe, it, expect } from 'vitest';

// Test tool logic in isolation (replicated from reviewer-tools.ts)

describe('search_pattern tool logic', () => {
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
  });

  it('should generate correct test patterns for React files', () => {
    const patterns = generateTestPatterns('src/components/Button.tsx');
    expect(patterns).toContain('src/components/Button.test.tsx');
    expect(patterns).toContain('src/components/__tests__/Button.test.tsx');
  });

  it('should handle files in root directory', () => {
    const patterns = generateTestPatterns('index.ts');
    // When file is in root, dir becomes '.' so patterns start with './'
    expect(patterns.some(p => p.includes('index.test.ts'))).toBe(true);
  });
});

describe('analyze_deps tool logic', () => {
  function analyzeDeps(filePath: string, fileContent: string): { issues: string[]; warnings: string[] } {
    const issues: string[] = [];
    const warnings: string[] = [];
    const isManifest = filePath.includes('package.json') || fileContent.includes('"dependencies"');

    if (isManifest) {
      const knownVulnerable: Record<string, string> = {
        'lodash@': '<4.17.21 may have prototype pollution',
        'express@': '<4.17.3 has open redirect vulnerability',
        'moment@': 'Deprecated - consider using date-fns or dayjs',
        'request@': 'Deprecated - use node-fetch or axios',
      };
      for (const [pkg, issue] of Object.entries(knownVulnerable)) {
        if (fileContent.includes(pkg)) issues.push(`${pkg}: ${issue}`);
      }
    }
    return { issues, warnings };
  }

  it('should detect known vulnerable packages', () => {
    const content = '{"dependencies": {"lodash@4.17.20": true}}';
    const result = analyzeDeps('package.json', content);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should detect deprecated packages', () => {
    const content = '{"dependencies": {"moment@2.29.0": true}}';
    const result = analyzeDeps('package.json', content);
    expect(result.issues.some(i => i.includes('moment'))).toBe(true);
  });

  it('should return no issues for clean dependencies', () => {
    const content = '{"dependencies": {"react": "^18.0.0"}}';
    const result = analyzeDeps('package.json', content);
    expect(result.issues).toHaveLength(0);
  });

  it('should not flag non-manifest files', () => {
    const content = 'const x = 1;';
    const result = analyzeDeps('src/index.ts', content);
    expect(result.issues).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
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
      { type: 'const/let/var', regex: new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escapeRegex(symbol)}\\s*=`) },
      { type: 'class', regex: new RegExp(`(?:export\\s+)?(?:default\\s+)?class\\s+${escapeRegex(symbol)}\\b`) },
      { type: 'interface', regex: new RegExp(`(?:export\\s+)?interface\\s+${escapeRegex(symbol)}\\b`) },
      { type: 'type', regex: new RegExp(`(?:export\\s+)?type\\s+${escapeRegex(symbol)}\\b`) },
    ];
    const usageRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`);

    for (const line of diffLines) {
      const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileHeader) { currentFile = fileHeader[1]; continue; }
      if (!currentFile || !line.startsWith('+') || line.startsWith('+++')) continue;

      let isDefinition = false;
      for (const { type, regex } of definitionPatterns) {
        if (regex.test(line)) { definitions.push({ file: currentFile, type }); isDefinition = true; break; }
      }
      if (!isDefinition && usageRegex.test(line)) { usages.push({ file: currentFile }); }
    }
    return { definitions, usages };
  }

  it('should find function definitions', () => {
    const diff = '+++ b/src/utils.ts\n+export function formatDate(date: string): string {';
    const result = symbolSearch('formatDate', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('function');
  });

  it('should find class definitions', () => {
    const diff = '+++ b/src/models.ts\n+export class User {';
    const result = symbolSearch('User', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('class');
  });

  it('should find interface definitions', () => {
    const diff = '+++ b/src/types.ts\n+export interface ReviewResult {';
    const result = symbolSearch('ReviewResult', diff);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].type).toBe('interface');
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
    const importPatterns = [/(?:import|from)\s+['"]([^'"]+)['"]/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g];

    let currentFile = '';
    for (const line of diffLines) {
      const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileHeader) { currentFile = fileHeader[1]; if (!importMap[currentFile]) importMap[currentFile] = []; continue; }
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
              if (cf === resolved || cf === resolved + '.ts' || cf === resolved + '.js' || cfNoExt === resolved) {
                if (!importMap[currentFile].includes(cf)) importMap[currentFile].push(cf);
                if (!reverseImportMap[cf]) reverseImportMap[cf] = [];
                if (!reverseImportMap[cf].includes(currentFile)) reverseImportMap[cf].push(currentFile);
              }
            }
          }
        }
      }
    }

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
        for (const neighbor of neighbors) { if (!visited.has(neighbor)) queue.push(neighbor); }
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
