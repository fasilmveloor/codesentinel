'use client';

import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Status badge component
export function StatusBadge({ status }: { status: string }) {
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
export function ScoreBadge({ score }: { score: string | null }) {
  if (!score) return <Badge variant="outline">&mdash;</Badge>;

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
export function SeverityBadge({ severity }: { severity: string | null }) {
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
