'use client';

import { useState } from 'react';
import { Github, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { AppConfig } from '@/types';

interface GitHubAppCardProps {
  config: AppConfig | null;
  saveConfig: (key: string, value: string, setter: (v: boolean) => void) => Promise<void>;
}

export function GitHubAppCard({ config, saveConfig }: GitHubAppCardProps) {
  const [tokenValue, setTokenValue] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [savingSecret, setSavingSecret] = useState(false);

  const [appIdValue, setAppIdValue] = useState('');
  const [appKeyValue, setAppKeyValue] = useState('');
  const [savingAppId, setSavingAppId] = useState(false);
  const [savingAppKey, setSavingAppKey] = useState(false);

  const [prevConfig, setPrevConfig] = useState<AppConfig | null>(null);
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config?.config.github_app_id) setAppIdValue(config.config.github_app_id);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub App Configuration
        </CardTitle>
        <CardDescription>
          Configure your GitHub App or Personal Access Token for API access
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="github-app-id">GitHub App ID</Label>
          <div className="flex gap-2">
            <Input
              id="github-app-id"
              placeholder="e.g. 123456"
              value={appIdValue}
              onChange={(e) => setAppIdValue(e.target.value)}
            />
            <Button
              onClick={() => saveConfig('github_app_id', appIdValue, setSavingAppId)}
              disabled={savingAppId || !appIdValue}
            >
              {savingAppId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The numeric App ID from your GitHub App settings
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="github-app-key">GitHub App Private Key</Label>
          <div className="flex gap-2">
            <Textarea
              id="github-app-key"
              placeholder={config?.hasGitHubApp ? '•••••••• (already set)' : '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'}
              value={appKeyValue}
              onChange={(e) => setAppKeyValue(e.target.value)}
              className="font-mono text-xs min-h-[80px]"
            />
            <Button
              onClick={() => saveConfig('github_app_private_key', appKeyValue, setSavingAppKey)}
              disabled={savingAppKey || !appKeyValue}
              className="shrink-0 self-start"
            >
              {savingAppKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste the full PEM private key from your GitHub App
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="github-token">GitHub Personal Access Token</Label>
          <div className="flex gap-2">
            <Input
              id="github-token"
              type="password"
              placeholder={config?.hasToken ? '•••••••• (already set)' : 'ghp_xxxxxxxxxxxx'}
              value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
            />
            <Button
              onClick={() => saveConfig('github_token', tokenValue, setSavingToken)}
              disabled={savingToken || !tokenValue}
            >
              {savingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Required permissions: repo (full control), read:org
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="webhook-secret">Webhook Secret</Label>
          <div className="flex gap-2">
            <Input
              id="webhook-secret"
              type="password"
              placeholder={config?.hasSecret ? '•••••••• (already set)' : 'Enter webhook secret'}
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
            />
            <Button
              onClick={() => saveConfig('webhook_secret', secretValue, setSavingSecret)}
              disabled={savingSecret || !secretValue}
            >
              {savingSecret ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional: Used to verify GitHub webhook signatures
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
