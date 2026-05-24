'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { AppConfig } from '@/types';
import { keyLabels } from './shared';
import { GitHubAppCard } from './github-app-card';
import { GitLabConfigCard } from './gitlab-config-card';
import { AIConfigCard } from './ai-config-card';
import { MergeProtectionCard } from './merge-protection-card';
import { CommentCommandsCard } from './comment-commands-card';
import { AccountCard } from './account-card';

interface SettingsTabProps {
  onLogout: () => void;
}

export function SettingsTab({ onLogout }: SettingsTabProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (res.status === 401) {
        window.location.href = '/auth/login';
        return;
      }
      const data = await res.json();
      setConfig(data);
    } catch {
      toast.error('Failed to fetch config');
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = async (key: string, value: string, setter: (v: boolean) => void) => {
    setter(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        toast.success(`${keyLabels[key] || key} saved`);
        fetchConfig();
      } else {
        toast.error('Failed to save config');
      }
    } catch {
      toast.error('Failed to save config');
    } finally {
      setter(false);
    }
  };

  return (
    <>
      <GitHubAppCard config={config} saveConfig={saveConfig} />
      <GitLabConfigCard config={config} saveConfig={saveConfig} />
      <AIConfigCard config={config} saveConfig={saveConfig} fetchConfig={fetchConfig} />
      <MergeProtectionCard config={config} saveConfig={saveConfig} fetchConfig={fetchConfig} />
      <CommentCommandsCard />
      <AccountCard onLogout={onLogout} />
    </>
  );
}
