'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  GitPullRequest,
  CheckCircle,
  Zap,
  Eye,
  Loader2,
  FileCode,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface ManualReviewTabProps {
  onReviewTriggered: () => void;
}

export function ManualReviewTab({ onReviewTriggered }: ManualReviewTabProps) {
  const [triggerOwner, setTriggerOwner] = useState('');
  const [triggerRepo, setTriggerRepo] = useState('');
  const [triggerPr, setTriggerPr] = useState('');
  const [platform, setPlatform] = useState<'github' | 'gitlab'>('github');
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ message: string; reviewId: string } | null>(null);

  const triggerReview = async () => {
    if (!triggerOwner || !triggerRepo || !triggerPr) {
      toast.error('Please fill in all fields');
      return;
    }
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch('/api/reviews/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: triggerOwner,
          repo: triggerRepo,
          prNumber: Number(triggerPr),
          platform,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerResult(data);
        toast.success('Review started! It will appear in the dashboard shortly.');
        onReviewTriggered();
      } else {
        toast.error(data.error || 'Failed to trigger review');
      }
    } catch {
      toast.error('Failed to trigger review');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            Trigger Manual Review
          </CardTitle>
          <CardDescription>
            Enter the repository and PR/MR details to start an AI-powered code review
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as 'github' | 'gitlab')}>
              <SelectTrigger id="platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="gitlab">GitLab</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner">Repository Owner</Label>
            <Input
              id="owner"
              placeholder={platform === 'gitlab' ? 'e.g. myorg/subgroup' : 'e.g. facebook'}
              value={triggerOwner}
              onChange={(e) => setTriggerOwner(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo">Repository Name</Label>
            <Input
              id="repo"
              placeholder="e.g. react"
              value={triggerRepo}
              onChange={(e) => setTriggerRepo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr">{platform === 'gitlab' ? 'MR' : 'PR'} Number</Label>
            <Input
              id="pr"
              type="number"
              placeholder="e.g. 12345"
              value={triggerPr}
              onChange={(e) => setTriggerPr(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            onClick={triggerReview}
            disabled={triggering}
          >
            {triggering ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting Review...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Start Review
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Review Result
          </CardTitle>
          <CardDescription>
            {triggerResult
              ? 'Review has been submitted for processing'
              : 'Results will appear here after triggering a review'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {triggering ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-4 border-muted border-t-primary animate-spin" />
                <GitPullRequest className="h-6 w-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Fetching {platform === 'gitlab' ? 'MR' : 'PR'} diff and running AI review...
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This may take a minute for large {platform === 'gitlab' ? 'merge requests' : 'pull requests'}
              </p>
            </div>
          ) : triggerResult ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-medium text-emerald-900 dark:text-emerald-300">
                    Review Started Successfully
                  </p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">
                    Review ID: {triggerResult.reviewId}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                The review is being processed. Switch to the Dashboard tab to monitor progress and see results.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  onReviewTriggered();
                  const tabs = document.querySelector('[data-value="dashboard"]') as HTMLElement;
                  tabs?.click();
                }}
              >
                <Zap className="h-4 w-4 mr-2" />
                Go to Dashboard
              </Button>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <FileCode className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Fill in the form and trigger a review<br />
                to see results here
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
