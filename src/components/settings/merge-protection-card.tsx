'use client';

import { useState } from 'react';
import { Shield, Loader2, AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import type { AppConfig } from '@/types';

interface MergeProtectionCardProps {
  config: AppConfig | null;
  saveConfig: (key: string, value: string, setter: (v: boolean) => void) => Promise<void>;
  fetchConfig: () => Promise<void>;
}

export function MergeProtectionCard({ config, fetchConfig }: MergeProtectionCardProps) {
  const [blockMergeValue, setBlockMergeValue] = useState(false);
  const [savingBlockMerge, setSavingBlockMerge] = useState(false);

  const [prevConfig, setPrevConfig] = useState<AppConfig | null>(null);
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config?.config.block_merge === 'true') setBlockMergeValue(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Merge Protection
        </CardTitle>
        <CardDescription>
          Control whether AI reviews can block merging of pull requests
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-base">Block Merge on Issues</Label>
            <p className="text-xs text-muted-foreground">
              When enabled, AI reviews that find issues will create a failing status check
            </p>
          </div>
          <Button
            variant={blockMergeValue ? 'default' : 'outline'}
            onClick={async () => {
              const newValue = !blockMergeValue;
              setBlockMergeValue(newValue);
              setSavingBlockMerge(true);
              try {
                const res = await fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: 'block_merge', value: String(newValue) }),
                });
                if (res.ok) {
                  toast.success(`Merge Protection ${newValue ? 'enabled' : 'disabled'}`);
                  fetchConfig();
                } else {
                  setBlockMergeValue(!newValue);
                  toast.error('Failed to update merge protection');
                }
              } catch {
                setBlockMergeValue(!newValue);
                toast.error('Failed to update merge protection');
              } finally {
                setSavingBlockMerge(false);
              }
            }}
            disabled={savingBlockMerge}
            className="min-w-[100px]"
          >
            {savingBlockMerge ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : blockMergeValue ? (
              'Enabled'
            ) : (
              'Disabled'
            )}
          </Button>
        </div>

        {blockMergeValue ? (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Branch Protection Required
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                When enabled, add &apos;CodeSentinel Review&apos; as a Required Status Check in your repository Branch Protection Rules to block merging.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800">
            <Info className="h-5 w-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-sky-800 dark:text-sky-300">
                Advisory Mode
              </p>
              <p className="text-xs text-sky-700 dark:text-sky-400">
                Check runs will be advisory only (neutral) and will NOT block merging.
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* GitHub App status indicator */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">GitHub App Status:</span>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${config?.hasGitHubApp ? 'bg-emerald-500' : 'bg-orange-400'}`} />
            <span className="text-sm font-medium">
              {config?.hasGitHubApp ? 'Configured' : 'Not Configured'}
            </span>
          </div>
          {!config?.hasGitHubApp && (
            <p className="text-xs text-muted-foreground">
              — Required for merge protection to work
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
