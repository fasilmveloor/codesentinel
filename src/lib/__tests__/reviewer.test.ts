import { describe, it, expect } from 'vitest';

// Replicate parseReviewFromContent and buildReviewResult logic for isolated testing
// These mirror the actual implementations in reviewer.ts

function parseReviewFromContent(content: string): Record<string, unknown> | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.action === 'final_review' || parsed.overallScore) return parsed;
    } catch { /* */ }
  }
  try {
    const parsed = JSON.parse(content.trim());
    if (parsed.action === 'final_review' || parsed.overallScore) return parsed;
  } catch { /* */ }
  return null;
}

interface AgentStep {
  step: string;
  description: string;
  tool?: string;
  timestamp: string;
}

function buildReviewResult(
  parsed: Record<string, unknown>,
  agentSteps: AgentStep[],
  modelUsed: string,
  totalTokens: number
) {
  agentSteps.push({
    step: 'review',
    description: `Produced final review: ${parsed.overallScore || 'comment'} with ${((parsed.comments || []) as Array<unknown>).length} comment(s)`,
    timestamp: new Date().toISOString(),
  });

  return {
    summary: (parsed.summary as string) || '',
    overallScore: (parsed.overallScore as string) || 'comment',
    comments: ((parsed.comments || []) as Array<Record<string, unknown>>).map((c) => ({
      filePath: (c.filePath as string) || '',
      line: (c.line as number) || null,
      side: (c.side as string) || null,
      body: (c.body as string) || '',
      severity: (c.severity as string) || 'info',
    })),
    agentSteps,
    modelUsed,
    tokensUsed: totalTokens,
  };
}

describe('parseReviewFromContent', () => {
  describe('valid JSON in ```json code block', () => {
    it('should parse valid review with action=final_review', () => {
      const content = 'Some text before\n```json\n{"action": "final_review", "summary": "LGTM", "overallScore": "approve", "comments": []}\n```';
      const result = parseReviewFromContent(content);
      expect(result).not.toBeNull();
      expect(result!.action).toBe('final_review');
      expect(result!.summary).toBe('LGTM');
      expect(result!.overallScore).toBe('approve');
      expect(result!.comments).toEqual([]);
    });

    it('should parse valid review with overallScore but no action', () => {
      const content = '```json\n{"summary": "Needs work", "overallScore": "request_changes", "comments": [{"filePath": "a.ts", "line": 1, "body": "fix", "severity": "error"}]}\n```';
      const result = parseReviewFromContent(content);
      expect(result).not.toBeNull();
      expect(result!.overallScore).toBe('request_changes');
      expect(result!.comments).toHaveLength(1);
    });

    it('should handle JSON with whitespace around the code block', () => {
      const content = '```json\n  \n{"action": "final_review", "overallScore": "comment"}\n  \n```';
      const result = parseReviewFromContent(content);
      expect(result).not.toBeNull();
      expect(result!.overallScore).toBe('comment');
    });

    it('should ignore JSON in code block that is not a review', () => {
      const content = '```json\n{"action": "tool_call", "tool": "fetch_file"}\n```';
      const result = parseReviewFromContent(content);
      expect(result).toBeNull();
    });

    it('should return null when code block has invalid JSON', () => {
      const content = '```json\n{not valid json}\n```\nSome text after';
      const result = parseReviewFromContent(content);
      expect(result).toBeNull();
    });
  });

  describe('raw JSON content', () => {
    it('should parse raw JSON with action=final_review', () => {
      const content = '{"action": "final_review", "summary": "OK", "overallScore": "approve", "comments": []}';
      const result = parseReviewFromContent(content);
      expect(result).not.toBeNull();
      expect(result!.action).toBe('final_review');
      expect(result!.summary).toBe('OK');
    });

    it('should parse raw JSON with overallScore', () => {
      const content = '{"overallScore": "comment", "summary": "Looks fine"}';
      const result = parseReviewFromContent(content);
      expect(result).not.toBeNull();
      expect(result!.overallScore).toBe('comment');
    });
  });

  describe('invalid input', () => {
    it('should return null for plain text', () => {
      expect(parseReviewFromContent('This is just plain text')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseReviewFromContent('')).toBeNull();
    });

    it('should return null for JSON without action or overallScore', () => {
      const content = '{"someKey": "someValue"}';
      expect(parseReviewFromContent(content)).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      expect(parseReviewFromContent('{invalid}')).toBeNull();
    });

    it('should return null for code block with non-review JSON', () => {
      const content = '```json\n{"tool": "fetch_file", "reasoning": "need more info"}\n```';
      expect(parseReviewFromContent(content)).toBeNull();
    });
  });

  describe('priority of code block over raw', () => {
    it('should prefer JSON from code block over raw JSON', () => {
      const content = '```json\n{"action": "final_review", "overallScore": "approve"}\n```\n{"action": "final_review", "overallScore": "request_changes"}';
      const result = parseReviewFromContent(content);
      expect(result).not.toBeNull();
      expect(result!.overallScore).toBe('approve');
    });
  });
});

describe('buildReviewResult', () => {
  it('should build a complete ReviewResult from parsed data', () => {
    const parsed = {
      action: 'final_review',
      summary: 'The PR looks good overall.',
      overallScore: 'approve',
      comments: [
        { filePath: 'src/index.ts', line: 42, side: 'RIGHT', body: 'Consider using const here.', severity: 'info' },
      ],
    };
    const agentSteps: AgentStep[] = [
      { step: 'analyze', description: 'Analyzing PR', timestamp: new Date().toISOString() },
    ];
    const result = buildReviewResult(parsed, agentSteps, 'test-model', 100);

    expect(result.summary).toBe('The PR looks good overall.');
    expect(result.overallScore).toBe('approve');
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].filePath).toBe('src/index.ts');
    expect(result.comments[0].line).toBe(42);
    expect(result.comments[0].side).toBe('RIGHT');
    expect(result.comments[0].body).toBe('Consider using const here.');
    expect(result.comments[0].severity).toBe('info');
    expect(result.modelUsed).toBe('test-model');
    expect(result.tokensUsed).toBe(100);
  });

  it('should default overallScore to "comment" when missing', () => {
    const parsed = { summary: 'Some summary' };
    const agentSteps: AgentStep[] = [];
    const result = buildReviewResult(parsed, agentSteps, 'model', 50);
    expect(result.overallScore).toBe('comment');
  });

  it('should default summary to empty string when missing', () => {
    const parsed = { overallScore: 'approve' };
    const agentSteps: AgentStep[] = [];
    const result = buildReviewResult(parsed, agentSteps, 'model', 0);
    expect(result.summary).toBe('');
  });

  it('should default comments to empty array when missing', () => {
    const parsed = { overallScore: 'approve', summary: 'LGTM' };
    const agentSteps: AgentStep[] = [];
    const result = buildReviewResult(parsed, agentSteps, 'model', 0);
    expect(result.comments).toEqual([]);
  });

  it('should default comment fields to safe values', () => {
    const parsed = { overallScore: 'request_changes', summary: 'Fix needed', comments: [{}] };
    const agentSteps: AgentStep[] = [];
    const result = buildReviewResult(parsed, agentSteps, 'model', 0);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].filePath).toBe('');
    expect(result.comments[0].line).toBeNull();
    expect(result.comments[0].side).toBeNull();
    expect(result.comments[0].body).toBe('');
    expect(result.comments[0].severity).toBe('info');
  });

  it('should append a review step to agentSteps', () => {
    const parsed = { overallScore: 'approve', summary: 'OK', comments: [] };
    const agentSteps: AgentStep[] = [];
    buildReviewResult(parsed, agentSteps, 'model', 0);
    expect(agentSteps).toHaveLength(1);
    expect(agentSteps[0].step).toBe('review');
    expect(agentSteps[0].description).toContain('approve');
    expect(agentSteps[0].timestamp).toBeTruthy();
  });

  it('should include the review step in the returned agentSteps', () => {
    const parsed = {
      overallScore: 'request_changes',
      summary: 'Needs fixes',
      comments: [{ filePath: 'a.ts', line: 1, body: 'error', severity: 'error' }],
    };
    const existingStep: AgentStep = { step: 'analyze', description: 'Analyzed PR', timestamp: new Date().toISOString() };
    const agentSteps: AgentStep[] = [existingStep];
    const result = buildReviewResult(parsed, agentSteps, 'model', 42);
    expect(result.agentSteps).toHaveLength(2);
    expect(result.agentSteps[0].step).toBe('analyze');
    expect(result.agentSteps[1].step).toBe('review');
  });

  it('should handle multiple comments with partial data', () => {
    const parsed = {
      overallScore: 'comment',
      summary: 'Mixed feedback',
      comments: [
        { filePath: 'a.ts', body: 'Issue 1', severity: 'warning' },
        { filePath: 'b.ts', line: 10, body: 'Issue 2', side: 'LEFT' },
      ],
    };
    const agentSteps: AgentStep[] = [];
    const result = buildReviewResult(parsed, agentSteps, 'model', 200);
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].line).toBeNull();
    expect(result.comments[0].side).toBeNull();
    expect(result.comments[0].severity).toBe('warning');
    expect(result.comments[1].severity).toBe('info');
    expect(result.comments[1].side).toBe('LEFT');
  });
});
