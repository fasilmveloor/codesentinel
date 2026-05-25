export function sanitizeString(input: string, maxLength: number = 10000): string {
  return input
    .replace(/\0/g, '')
    .substring(0, maxLength)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .trim();
}

export function validatePRNumber(prNumber: unknown): { valid: boolean; value: number } {
  const num = typeof prNumber === 'string' ? parseInt(prNumber, 10) : typeof prNumber === 'number' ? prNumber : NaN;
  if (isNaN(num) || num < 1 || num > 1000000 || !Number.isInteger(num)) return { valid: false, value: 0 };
  return { valid: true, value: num };
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateOwnerRepo(owner: string, repo: string): boolean {
  const REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
  return REPO_NAME_REGEX.test(owner) && REPO_NAME_REGEX.test(repo);
}

export function sanitizeFilePath(filePath: string): string | null {
  if (!filePath || filePath.length === 0) return null;
  if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) return null;
  if (filePath.includes('\0')) return null;
  return filePath;
}
