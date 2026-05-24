export interface ReviewComment {
  id: string;
  filePath: string;
  line: number | null;
  side: string | null;
  body: string;
  severity: string | null;
  createdAt: string;
}

export interface AgentStepData {
  step: string;
  description: string;
  tool?: string;
  timestamp: string;
  reasoning?: string;
  conclusion?: string;
  evidence?: string;
  durationMs?: number;
}

export interface Review {
  id: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prUrl: string;
  platform?: string;
  status: string;
  summary: string | null;
  overallScore: string | null;
  createdAt: string;
  updatedAt: string;
  repository?: { fullName: string };
  _count?: { comments: number };
  comments?: ReviewComment[];
  repositoryId?: string;
  agentSteps?: string;
  modelUsed?: string;
  tokensUsed?: number;
}

export interface ReviewDetail extends Review {
  repository: { fullName: string; owner: string; name: string };
  comments: ReviewComment[];
  agentSteps?: string;
  modelUsed?: string;
  tokensUsed?: number;
}

export interface AppConfig {
  config: Record<string, string>;
  hasToken: boolean;
  hasSecret: boolean;
  hasGitHubApp: boolean;
  hasGitLabToken: boolean;
  hasGitLabWebhookSecret: boolean;
  hasAiModel: boolean;
  hasAiProvider: boolean;
  blockMerge: boolean;
}
