import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { CONFIG_VALUE_MAX_LENGTH, MASK_MIN_LENGTH } from '@/lib/constants';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';

const SENSITIVE_KEYS = [
  'github_token',
  'github_app_private_key',
  'gitlab_token',
  'gitlab_webhook_secret',
  'webhook_secret',
  'ai_api_key',
];

function maskValue(value: string): string {
  if (value.length <= MASK_MIN_LENGTH) return '••••••••';
  // For short values (9-11 chars), show only first 2 and last 2 to avoid over-revealing
  if (value.length <= 12) return value.substring(0, 2) + '••••' + value.substring(value.length - 2);
  return value.substring(0, 4) + '••••' + value.substring(value.length - 4);
}

export async function GET(request: NextRequest) {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const configs = await db.appConfig.findMany();
    const configMap: Record<string, string> = {};

    for (const config of configs) {
      if (SENSITIVE_KEYS.includes(config.key)) {
        configMap[config.key] = config.value ? maskValue(config.value) : '';
      } else {
        configMap[config.key] = config.value;
      }
    }

    const hasToken = configs.some((c) => c.key === 'github_token' && c.value);
    const hasSecret = configs.some((c) => c.key === 'webhook_secret' && c.value);
    const hasGitHubApp = configs.some((c) => c.key === 'github_app_id' && c.value) &&
      configs.some((c) => c.key === 'github_app_private_key' && c.value);
    const hasGitLabToken = configs.some((c) => c.key === 'gitlab_token' && c.value);
    const hasGitLabWebhookSecret = configs.some((c) => c.key === 'gitlab_webhook_secret' && c.value);
    const hasAiModel = configs.some((c) => c.key === 'ai_model' && c.value);
    const hasAiProvider = configs.some((c) => c.key === 'ai_provider' && c.value) ||
      configs.some((c) => c.key === 'ai_api_key' && c.value);
    const blockMerge = configs.find((c) => c.key === 'block_merge')?.value === 'true';

    return NextResponse.json({
      config: configMap,
      hasToken,
      hasSecret,
      hasGitHubApp,
      hasGitLabToken,
      hasGitLabWebhookSecret,
      hasAiModel,
      hasAiProvider,
      blockMerge,
    });
  } catch (error) {
    logger.error('Failed to fetch config', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Missing required fields: key, value' }, { status: 400 });
    }

    // Validate key is a string
    if (typeof key !== 'string' || key.length === 0 || key.length > 100) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    // Validate value length
    if (typeof value !== 'string' || value.length > CONFIG_VALUE_MAX_LENGTH) {
      return NextResponse.json({ error: `Value exceeds max length of ${CONFIG_VALUE_MAX_LENGTH}` }, { status: 400 });
    }

    const allowedKeys = [
      'github_token',
      'webhook_secret',
      'github_app_id',
      'github_app_private_key',
      'gitlab_token',
      'gitlab_host',
      'gitlab_webhook_secret',
      'ai_provider',
      'ai_model',
      'ai_api_key',
      'ai_base_url',
      'ai_temperature',
      'ai_max_steps',
      'block_merge',
      'ignore_patterns',
    ];

    if (!allowedKeys.includes(key)) {
      return NextResponse.json({ error: `Invalid config key. Allowed: ${allowedKeys.join(', ')}` }, { status: 400 });
    }

    await db.appConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    return NextResponse.json({ message: 'Config updated successfully' });
  } catch (error) {
    logger.error('Failed to update config', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
