'use client';

import { useState } from 'react';
import { GitPullRequest, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { AppConfig } from '@/types';

interface GitLabConfigCardProps {
  config: AppConfig | null;
  saveConfig: (key: string, value: string, setter: (v: boolean) => void) => Promise<void>;
}

export function GitLabConfigCard({ config, saveConfig }: GitLabConfigCardProps) {
  const [gitlabTokenValue, setGitlabTokenValue] = useState('');
  const [gitlabHostValue, setGitlabHostValue] = useState('https://gitlab.com');
  const [gitlabWebhookSecretValue, setGitlabWebhookSecretValue] = useState('');
  const [savingGitLabToken, setSavingGitLabToken] = useState(false);
  const [savingGitLabHost, setSavingGitLabHost] = useState(false);
  const [savingGitLabWebhookSecret, setSavingGitLabWebhookSecret] = useState(false);

  const [prevConfig, setPrevConfig] = useState<AppConfig | null>(null);
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config?.config.gitlab_host) setGitlabHostValue(config.config.gitlab_host);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="h-5 w-5" />
          GitLab Configuration
        </CardTitle>
        <CardDescription>
          Configure GitLab integration for merge request reviews
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gitlab-token">GitLab Token</Label>
          <div className="flex gap-2">
            <Input
              id="gitlab-token"
              type="password"
              placeholder={config?.hasGitLabToken ? '•••••••• (already set)' : 'glpat-xxxxxxxxxxxx'}
              value={gitlabTokenValue}
              onChange={(e) => setGitlabTokenValue(e.target.value)}
            />
            <Button
              onClick={() => saveConfig('gitlab_token', gitlabTokenValue, setSavingGitLabToken)}
              disabled={savingGitLabToken || !gitlabTokenValue}
            >
              {savingGitLabToken ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Personal access token with api scope
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="gitlab-host">GitLab Host URL</Label>
          <div className="flex gap-2">
            <Input
              id="gitlab-host"
              placeholder="https://gitlab.com"
              value={gitlabHostValue}
              onChange={(e) => setGitlabHostValue(e.target.value)}
            />
            <Button
              onClick={() => saveConfig('gitlab_host', gitlabHostValue, setSavingGitLabHost)}
              disabled={savingGitLabHost || !gitlabHostValue}
            >
              {savingGitLabHost ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use https://gitlab.com for SaaS, or your self-hosted GitLab URL
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="gitlab-webhook-secret">GitLab Webhook Secret</Label>
          <div className="flex gap-2">
            <Input
              id="gitlab-webhook-secret"
              type="password"
              placeholder={config?.hasGitLabWebhookSecret ? '•••••••• (already set)' : 'Enter GitLab webhook secret'}
              value={gitlabWebhookSecretValue}
              onChange={(e) => setGitlabWebhookSecretValue(e.target.value)}
            />
            <Button
              onClick={() => saveConfig('gitlab_webhook_secret', gitlabWebhookSecretValue, setSavingGitLabWebhookSecret)}
              disabled={savingGitLabWebhookSecret || !gitlabWebhookSecretValue}
            >
              {savingGitLabWebhookSecret ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional: Used to verify GitLab webhook signatures
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
