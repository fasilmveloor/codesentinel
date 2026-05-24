export interface ReviewComment {
  id: string;
  filePath: string;
  line: number | null;
  side: string | null;
  body: string;
  severity: string | null;
  createdAt: string;
}

export interface Review {
  id: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prUrl: string;
  status: string;
  summary: string | null;
  overallScore: string | null;
  createdAt: string;
  updatedAt: string;
  repository?: { fullName: string };
  _count?: { comments: number };
  comments?: ReviewComment[];
  repositoryId?: string;
}

export interface ReviewDetail extends Review {
  repository: { fullName: string; owner: string; name: string };
  comments: ReviewComment[];
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

export interface TriggerResult {
  message: string;
  reviewId: string;
}

export type SaveConfigFn = (key: string, value: string, setter: (v: boolean) => void) => Promise<void>;
