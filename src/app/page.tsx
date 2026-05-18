'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitPullRequest,
  Settings,
  Zap,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  Github,
  ExternalLink,
  RefreshCw,
  Trash2,
  Eye,
  Clock,
  Loader2,
  Shield,
  MessageSquare,
  ChevronRight,
  FileCode,
  AlertCircle,
  LogOut,
  KeyRound,
  Lock,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

// Types
interface ReviewComment {
  id: string;
  filePath: string;
  line: number | null;
  side: string | null;
  body: string;
  severity: string | null;
  createdAt: string;
}

interface Review {
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

interface ReviewDetail extends Review {
  repository: { fullName: string; owner: string; name: string };
  comments: ReviewComment[];
}

interface AppConfig {
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

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; label: string }> = {
    pending: { variant: 'outline', icon: <Clock className="h-3 w-3" />, label: 'Pending' },
    reviewing: { variant: 'secondary', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Reviewing' },
    completed: { variant: 'default', icon: <CheckCircle className="h-3 w-3" />, label: 'Completed' },
    failed: { variant: 'destructive', icon: <XCircle className="h-3 w-3" />, label: 'Failed' },
  };

  const config = variants[status] || variants.pending;

  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}

// Score badge component
function ScoreBadge({ score }: { score: string | null }) {
  if (!score) return <Badge variant="outline">—</Badge>;

  const variants: Record<string, { className: string; icon: React.ReactNode; label: string }> = {
    approve: {
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
      icon: <CheckCircle className="h-3 w-3" />,
      label: 'Approved',
    },
    request_changes: {
      className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
      icon: <AlertTriangle className="h-3 w-3" />,
      label: 'Changes Requested',
    },
    comment: {
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
      icon: <Info className="h-3 w-3" />,
      label: 'Comment',
    },
  };

  const config = variants[score] || variants.comment;

  return (
    <Badge variant="outline" className={`gap-1 ${config.className}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

// Severity badge component
function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;

  const variants: Record<string, { className: string; icon: React.ReactNode }> = {
    critical: {
      className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      icon: <AlertCircle className="h-3 w-3" />,
    },
    error: {
      className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      icon: <XCircle className="h-3 w-3" />,
    },
    warning: {
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    info: {
      className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
      icon: <Info className="h-3 w-3" />,
    },
  };

  const config = variants[severity] || variants.info;

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.icon}
      {severity.toUpperCase()}
    </span>
  );
}

// Stat card component
function StatCard({
  title,
  value,
  icon,
  description,
  color,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  description?: string;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative overflow-hidden">
        <div className={`absolute top-0 left-0 h-1 w-full ${color}`} />
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <div className={`${color} rounded-md p-2 text-white`}>{icon}</div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Home() {
  // State
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReview, setSelectedReview] = useState<ReviewDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [savingSecret, setSavingSecret] = useState(false);

  // GitHub App state
  const [appIdValue, setAppIdValue] = useState('');
  const [appKeyValue, setAppKeyValue] = useState('');
  const [savingAppId, setSavingAppId] = useState(false);
  const [savingAppKey, setSavingAppKey] = useState(false);

  // GitLab state
  const [gitlabTokenValue, setGitlabTokenValue] = useState('');
  const [gitlabHostValue, setGitlabHostValue] = useState('https://gitlab.com');
  const [gitlabWebhookSecretValue, setGitlabWebhookSecretValue] = useState('');
  const [savingGitLabToken, setSavingGitLabToken] = useState(false);
  const [savingGitLabHost, setSavingGitLabHost] = useState(false);
  const [savingGitLabWebhookSecret, setSavingGitLabWebhookSecret] = useState(false);

  // AI Configuration state
  const [aiProviderValue, setAiProviderValue] = useState<'z-ai' | 'openai-compatible'>('z-ai');
  const [aiModelValue, setAiModelValue] = useState('');
  const [aiApiKeyValue, setAiApiKeyValue] = useState('');
  const [aiBaseUrlValue, setAiBaseUrlValue] = useState('https://api.oencode.com/v1');
  const [aiTemperatureValue, setAiTemperatureValue] = useState(0.3);
  const [aiMaxStepsValue, setAiMaxStepsValue] = useState(5);
  const [savingAiProvider, setSavingAiProvider] = useState(false);
  const [savingAiModel, setSavingAiModel] = useState(false);
  const [savingAiApiKey, setSavingAiApiKey] = useState(false);
  const [savingAiBaseUrl, setSavingAiBaseUrl] = useState(false);
  const [savingAiTemperature, setSavingAiTemperature] = useState(false);
  const [savingAiMaxSteps, setSavingAiMaxSteps] = useState(false);

  // Merge Protection state
  const [blockMergeValue, setBlockMergeValue] = useState(false);
  const [savingBlockMerge, setSavingBlockMerge] = useState(false);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Manual review form
  const [triggerOwner, setTriggerOwner] = useState('');
  const [triggerRepo, setTriggerRepo] = useState('');
  const [triggerPr, setTriggerPr] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ message: string; reviewId: string } | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Fetch reviews
  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/reviews?${params}`);
      if (res.status === 401) {
        window.location.href = '/auth/login';
        return;
      }
      const data = await res.json();
      setReviews(data.reviews || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch {
      toast.error('Failed to fetch reviews');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (res.status === 401) {
        window.location.href = '/auth/login';
        return;
      }
      const data = await res.json();
      setConfig(data);
      // Initialize state from config
      if (data.config.ai_provider) setAiProviderValue(data.config.ai_provider as 'z-ai' | 'openai-compatible');
      if (data.config.ai_model) setAiModelValue(data.config.ai_model);
      if (data.config.ai_api_key) setAiApiKeyValue(data.config.ai_api_key);
      if (data.config.ai_base_url) setAiBaseUrlValue(data.config.ai_base_url);
      if (data.config.ai_temperature) setAiTemperatureValue(parseFloat(data.config.ai_temperature));
      if (data.config.ai_max_steps) setAiMaxStepsValue(parseInt(data.config.ai_max_steps, 10));
      if (data.config.gitlab_host) setGitlabHostValue(data.config.gitlab_host);
      if (data.config.block_merge === 'true') setBlockMergeValue(true);
      if (data.config.github_app_id) setAppIdValue(data.config.github_app_id);
    } catch {
      toast.error('Failed to fetch config');
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Auto-refresh for pending/reviewing items
  useEffect(() => {
    const hasActive = reviews.some((r) => r.status === 'pending' || r.status === 'reviewing');
    if (!hasActive) return;

    const interval = setInterval(() => {
      fetchReviews();
    }, 5000);
    return () => clearInterval(interval);
  }, [reviews, fetchReviews]);

  // Open review detail
  const openReviewDetail = async (reviewId: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}`);
      const data = await res.json();
      setSelectedReview(data.review);
    } catch {
      toast.error('Failed to fetch review details');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // Delete review
  const deleteReview = async (reviewId: string) => {
    try {
      await fetch(`/api/reviews/${reviewId}`, { method: 'DELETE' });
      toast.success('Review deleted');
      fetchReviews();
      setDetailOpen(false);
    } catch {
      toast.error('Failed to delete review');
    }
  };

  // Key display names for toast messages
  const keyLabels: Record<string, string> = {
    github_token: 'GitHub Token',
    webhook_secret: 'Webhook Secret',
    github_app_id: 'GitHub App ID',
    github_app_private_key: 'GitHub App Private Key',
    gitlab_token: 'GitLab Token',
    gitlab_host: 'GitLab Host',
    gitlab_webhook_secret: 'GitLab Webhook Secret',
    ai_provider: 'AI Provider',
    ai_model: 'AI Model',
    ai_api_key: 'AI API Key',
    ai_base_url: 'AI Base URL',
    ai_temperature: 'AI Temperature',
    ai_max_steps: 'AI Max Steps',
    block_merge: 'Merge Protection',
  };

  // Save config
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

  // Trigger manual review
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
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerResult(data);
        toast.success('Review started! It will appear in the dashboard shortly.');
        fetchReviews();
      } else {
        toast.error(data.error || 'Failed to trigger review');
      }
    } catch {
      toast.error('Failed to trigger review');
    } finally {
      setTriggering(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/auth/login';
    } catch {
      // Force redirect even if logout API fails
      window.location.href = '/auth/login';
    }
  };

  // Change password handler
  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('Please fill in all password fields');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();

      if (res.ok) {
        toast.success('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      } else {
        toast.error(data.error || 'Failed to change password');
      }
    } catch {
      toast.error('Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  // Calculate stats
  const totalReviews = reviews.length;
  const approved = reviews.filter((r) => r.overallScore === 'approve').length;
  const changesRequested = reviews.filter((r) => r.overallScore === 'request_changes').length;

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary rounded-lg p-2">
              <GitPullRequest className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">AI PR Reviewer</h1>
              <p className="text-xs text-muted-foreground">Automated code review powered by AI</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Shield className="h-3 w-3" />
              Admin
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fetchReviews()}
              title="Refresh reviews"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Sign out"
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="dashboard" className="gap-2">
              <Zap className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="review" className="gap-2">
              <GitPullRequest className="h-4 w-4" />
              Manual Review
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Reviews"
                value={totalReviews}
                icon={<GitPullRequest className="h-4 w-4" />}
                color="bg-primary"
                description="All time"
              />
              <StatCard
                title="Approved"
                value={approved}
                icon={<CheckCircle className="h-4 w-4" />}
                color="bg-emerald-500"
                description="Ready to merge"
              />
              <StatCard
                title="Changes Requested"
                value={changesRequested}
                icon={<AlertTriangle className="h-4 w-4" />}
                color="bg-red-500"
                description="Needs attention"
              />
              <StatCard
                title="Active Reviews"
                value={reviews.filter((r) => r.status === 'reviewing' || r.status === 'pending').length}
                icon={<Loader2 className="h-4 w-4" />}
                color="bg-amber-500"
                description="In progress"
              />
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">Filter:</span>
              {['', 'pending', 'reviewing', 'completed', 'failed'].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                >
                  {s || 'All'}
                </Button>
              ))}
            </div>

            {/* Reviews Table */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Reviews</CardTitle>
                <CardDescription>Click any row to view full review details</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <Skeleton className="h-4 w-8" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-28" />
                      </div>
                    ))}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="text-center py-12">
                    <GitPullRequest className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-1">No reviews yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Trigger a manual review or set up a webhook to get started
                    </p>
                    <Button variant="outline" onClick={() => {
                      const tabs = document.querySelector('[data-value="review"]') as HTMLElement;
                      tabs?.click();
                    }}>
                      Start a Review
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">PR#</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Repository</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Score</TableHead>
                            <TableHead>Comments</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <AnimatePresence>
                            {reviews.map((review, idx) => (
                              <motion.tr
                                key={review.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className="cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => openReviewDetail(review.id)}
                              >
                                <TableCell className="font-mono text-sm">
                                  #{review.prNumber}
                                </TableCell>
                                <TableCell>
                                  <div className="max-w-xs truncate font-medium">
                                    {review.prTitle}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    by {review.prAuthor}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="font-mono text-xs">
                                    {review.repository?.fullName || '—'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={review.status} />
                                </TableCell>
                                <TableCell>
                                  <ScoreBadge score={review.overallScore} />
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {review._count?.comments || 0}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                  {formatDate(review.createdAt)}
                                </TableCell>
                                <TableCell>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </TableCell>
                              </motion.tr>
                            ))}
                          </AnimatePresence>
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t">
                        <p className="text-sm text-muted-foreground">
                          Page {page} of {totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => setPage(page - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= totalPages}
                            onClick={() => setPage(page + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Manual Review Tab */}
          <TabsContent value="review" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GitPullRequest className="h-5 w-5" />
                    Trigger Manual Review
                  </CardTitle>
                  <CardDescription>
                    Enter the repository and PR details to start an AI-powered code review
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="owner">Repository Owner</Label>
                    <Input
                      id="owner"
                      placeholder="e.g. facebook"
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
                    <Label htmlFor="pr">PR Number</Label>
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
                        Fetching PR diff and running AI review...
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        This may take a minute for large PRs
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
                          fetchReviews();
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
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            {/* 1. GitHub App Configuration */}
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

            {/* 2. GitLab Configuration */}
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

            {/* 3. AI Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  AI Configuration
                </CardTitle>
                <CardDescription>
                  Configure the AI provider and model used for code reviews
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Provider selector */}
                <div className="space-y-3">
                  <Label>AI Provider</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={aiProviderValue === 'z-ai' ? 'default' : 'outline'}
                      onClick={() => {
                        setAiProviderValue('z-ai');
                        saveConfig('ai_provider', 'z-ai', setSavingAiProvider);
                      }}
                      disabled={savingAiProvider}
                      className="flex-1"
                    >
                      {savingAiProvider && aiProviderValue === 'z-ai' ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Z-AI (Default)
                    </Button>
                    <Button
                      variant={aiProviderValue === 'openai-compatible' ? 'default' : 'outline'}
                      onClick={() => {
                        setAiProviderValue('openai-compatible');
                        saveConfig('ai_provider', 'openai-compatible', setSavingAiProvider);
                      }}
                      disabled={savingAiProvider}
                      className="flex-1"
                    >
                      {savingAiProvider && aiProviderValue === 'openai-compatible' ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      OpenAI-Compatible (Zen/Oencode)
                    </Button>
                  </div>
                </div>

                {/* Provider-specific fields */}
                {aiProviderValue === 'z-ai' ? (
                  <div className="space-y-3">
                    <Label>Model</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={!aiModelValue || aiModelValue === 'default' ? 'default' : 'outline'}
                        onClick={() => {
                          setAiModelValue('default');
                          saveConfig('ai_model', 'default', setSavingAiModel);
                        }}
                        disabled={savingAiModel}
                        className="flex-1"
                      >
                        Default
                      </Button>
                      <Button
                        variant={aiModelValue === 'advanced' ? 'default' : 'outline'}
                        onClick={() => {
                          setAiModelValue('advanced');
                          saveConfig('ai_model', 'advanced', setSavingAiModel);
                        }}
                        disabled={savingAiModel}
                        className="flex-1"
                      >
                        Advanced
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Default uses a balanced model; Advanced uses a more capable model for complex reviews
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="space-y-2">
                      <Label htmlFor="ai-model-name">Model Name</Label>
                      <div className="flex gap-2">
                        <Input
                          id="ai-model-name"
                          placeholder="e.g. gpt-4o, claude-3-opus"
                          value={aiModelValue}
                          onChange={(e) => setAiModelValue(e.target.value)}
                        />
                        <Button
                          onClick={() => saveConfig('ai_model', aiModelValue, setSavingAiModel)}
                          disabled={savingAiModel || !aiModelValue}
                        >
                          {savingAiModel ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ai-api-key">API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          id="ai-api-key"
                          type="password"
                          placeholder={config?.hasAiProvider ? '•••••••• (already set)' : 'sk-xxxxxxxxxxxx'}
                          value={aiApiKeyValue}
                          onChange={(e) => setAiApiKeyValue(e.target.value)}
                        />
                        <Button
                          onClick={() => saveConfig('ai_api_key', aiApiKeyValue, setSavingAiApiKey)}
                          disabled={savingAiApiKey || !aiApiKeyValue}
                        >
                          {savingAiApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ai-base-url">Base URL</Label>
                      <div className="flex gap-2">
                        <Input
                          id="ai-base-url"
                          placeholder="https://api.oencode.com/v1"
                          value={aiBaseUrlValue}
                          onChange={(e) => setAiBaseUrlValue(e.target.value)}
                        />
                        <Button
                          onClick={() => saveConfig('ai_base_url', aiBaseUrlValue, setSavingAiBaseUrl)}
                          disabled={savingAiBaseUrl || !aiBaseUrlValue}
                        >
                          {savingAiBaseUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Default: https://api.oencode.com/v1
                      </p>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Temperature */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Temperature</Label>
                    <span className="text-sm font-mono text-muted-foreground">{aiTemperatureValue.toFixed(1)}</span>
                  </div>
                  <Slider
                    value={[aiTemperatureValue]}
                    onValueChange={(v) => setAiTemperatureValue(v[0])}
                    min={0}
                    max={1}
                    step={0.1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Lower values are more focused and deterministic; higher values are more creative
                  </p>
                </div>

                <Separator />

                {/* Max Agent Steps */}
                <div className="space-y-2">
                  <Label htmlFor="ai-max-steps">Max Agent Steps</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      id="ai-max-steps"
                      type="number"
                      min={1}
                      max={10}
                      value={aiMaxStepsValue}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1 && val <= 10) {
                          setAiMaxStepsValue(val);
                        }
                      }}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground">(1–10)</span>
                    <Button
                      onClick={() => saveConfig('ai_max_steps', String(aiMaxStepsValue), setSavingAiMaxSteps)}
                      disabled={savingAiMaxSteps}
                      className="ml-auto"
                    >
                      {savingAiMaxSteps ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Maximum number of reasoning steps the AI agent can take per review
                  </p>
                </div>

                <Separator />

                {/* Save AI Configuration */}
                <Button
                  className="w-full"
                  onClick={async () => {
                    setSavingAiTemperature(true);
                    try {
                      await fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: 'ai_temperature', value: String(aiTemperatureValue) }),
                      });
                      toast.success('AI Configuration saved');
                      fetchConfig();
                    } catch {
                      toast.error('Failed to save AI configuration');
                    } finally {
                      setSavingAiTemperature(false);
                    }
                  }}
                  disabled={savingAiTemperature}
                >
                  {savingAiTemperature ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Save AI Configuration
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* 4. Merge Protection */}
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
                        When enabled, add &apos;AI Code Review&apos; as a Required Status Check in your repository Branch Protection Rules to block merging.
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

            {/* 5. Comment Commands */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Comment Commands
                </CardTitle>
                <CardDescription>
                  Bot commands you can use in PR comments to trigger reviews
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Available Commands</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { cmd: '/review', desc: 'Start a full review' },
                      { cmd: '/recheck', desc: 'Re-review after changes' },
                      { cmd: '/check', desc: 'Quick check' },
                      { cmd: '/re-review', desc: 'Full re-review' },
                    ].map((item) => (
                      <div key={item.cmd} className="rounded-lg border p-3 text-center space-y-1">
                        <code className="text-sm font-mono font-semibold text-primary">{item.cmd}</code>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="text-sm font-medium">How to Use</h4>
                  <p className="text-sm text-muted-foreground">
                    Reply to the bot&apos;s review comment or post a new PR comment with a command
                  </p>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Examples</h4>
                  <div className="space-y-2">
                    <div className="rounded-lg border p-3 space-y-1">
                      <code className="text-sm font-mono font-semibold">/check src/auth.ts</code>
                      <p className="text-xs text-muted-foreground">
                        Focus review on a specific file
                      </p>
                    </div>
                    <div className="rounded-lg border p-3 space-y-1">
                      <code className="text-sm font-mono font-semibold">/recheck please verify the error handling is correct</code>
                      <p className="text-xs text-muted-foreground">
                        Ask a question or provide context for the re-review
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 5. Account / Change Password */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5" />
                  Account
                </CardTitle>
                <CardDescription>
                  Change your admin password or sign out of the dashboard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                  <Input
                    id="confirm-new-password"
                    type="password"
                    placeholder="Re-enter new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleChangePassword}
                    disabled={changingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                  >
                    {changingPassword ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Changing...
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4 mr-2" />
                        Change Password
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="text-destructive hover:text-destructive"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t py-4 mt-auto">
        <div className="container mx-auto px-4 flex items-center justify-between text-sm text-muted-foreground">
          <p>AI PR Reviewer — Automated code review powered by AI</p>
          <p>Built with Next.js &amp; shadcn/ui</p>
        </div>
      </footer>

      {/* Review Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          {detailLoading ? (
            <div className="space-y-4 py-8">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : selectedReview ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <GitPullRequest className="h-5 w-5" />
                  #{selectedReview.prNumber} {selectedReview.prTitle}
                </DialogTitle>
                <DialogDescription className="flex items-center gap-3 flex-wrap">
                  <Badge variant="outline" className="font-mono">
                    {selectedReview.repository?.fullName}
                  </Badge>
                  <span className="text-sm">by <strong>{selectedReview.prAuthor}</strong></span>
                  <StatusBadge status={selectedReview.status} />
                  <ScoreBadge score={selectedReview.overallScore} />
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-2">
                <a
                  href={selectedReview.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on GitHub
                </a>
                <span className="text-muted-foreground text-xs">
                  {formatDate(selectedReview.createdAt)}
                </span>
              </div>

              <ScrollArea className="flex-1 -mx-6 px-6">
                <div className="space-y-4 pb-4">
                  {/* Summary */}
                  {selectedReview.summary && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Summary</h4>
                      <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
                        {selectedReview.summary}
                      </div>
                    </div>
                  )}

                  {/* Comments */}
                  {selectedReview.comments && selectedReview.comments.length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold">
                        Review Comments ({selectedReview.comments.length})
                      </h4>
                      {selectedReview.comments.map((comment, idx) => (
                        <motion.div
                          key={comment.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="rounded-lg border p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <SeverityBadge severity={comment.severity} />
                            <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                              {comment.filePath}
                            </code>
                            {comment.line && (
                              <span className="text-xs text-muted-foreground">
                                Line {comment.line}
                                {comment.side ? ` (${comment.side})` : ''}
                              </span>
                            )}
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
                        </motion.div>
                      ))}
                    </div>
                  ) : selectedReview.status === 'completed' ? (
                    <div className="text-center py-6">
                      <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No issues found — clean review!
                      </p>
                    </div>
                  ) : null}
                </div>
              </ScrollArea>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-4 border-t">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteReview(selectedReview.id)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    fetchReviews();
                    openReviewDetail(selectedReview.id);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Refresh
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
