// Constants to replace magic numbers

// API Timeouts (in milliseconds)
export const DEFAULT_TIMEOUT = 30000;
export const GITHUB_API_TIMEOUT = 15000;
export const AI_API_TIMEOUT = 60000;

// Diff/Content limits
export const DIFF_MAX_LENGTH = 50000;
export const FILE_CONTENT_TRUNCATE = 8000;
export const GITHUB_FILE_CONTENT_TRUNCATE = 10000;

// GitHub API limits
export const GITHUB_REVIEW_BODY_MAX = 65536;
export const GITHUB_ANNOTATION_LIMIT = 50;

// Config validation
export const CONFIG_VALUE_MAX_LENGTH = 10000;
export const MASK_MIN_LENGTH = 8;

// Rate limiting
export const RATE_LIMIT_WINDOW = 60000; // 1 minute
export const RATE_LIMIT_MAX = 30; // max requests per window
export const LOGIN_RATE_LIMIT_MAX = 5; // Max login attempts per minute

// Review timeout
export const REVIEW_TIMEOUT_MS = 120000; // 2 minutes

// Pagination defaults
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

// Owner/repo validation regex (basic)
export const REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;