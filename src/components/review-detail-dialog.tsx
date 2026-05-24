'use client';

import { motion } from 'framer-motion';
import {
  GitPullRequest,
  ExternalLink,
  RefreshCw,
  Trash2,
  CheckCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge, ScoreBadge, SeverityBadge } from '@/components/badges';
import { ReasoningTrace } from '@/components/reasoning-trace';
import type { ReviewDetail } from '@/types';

interface ReviewDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: ReviewDetail | null;
  loading: boolean;
  onDelete: (reviewId: string) => void;
  onRefresh: (reviewId: string) => void;
  formatDate: (dateStr: string) => string;
}

export function ReviewDetailDialog({
  open,
  onOpenChange,
  review,
  loading,
  onDelete,
  onRefresh,
  formatDate,
}: ReviewDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {loading ? (
          <div className="space-y-4 py-8">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : review ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <GitPullRequest className="h-5 w-5" />
                #{review.prNumber} {review.prTitle}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" className="font-mono">
                  {review.repository?.fullName}
                </Badge>
                {review.platform && (
                  <Badge variant="secondary" className="text-xs capitalize">
                    {review.platform}
                  </Badge>
                )}
                <span className="text-sm">by <strong>{review.prAuthor}</strong></span>
                <StatusBadge status={review.status} />
                <ScoreBadge score={review.overallScore} />
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2">
              <a
                href={review.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {review.platform === 'gitlab' ? 'View on GitLab' : 'View on GitHub'}
              </a>
              <span className="text-muted-foreground text-xs">
                {formatDate(review.createdAt)}
              </span>
            </div>

            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-4 pb-4">
                {/* Summary */}
                {review.summary && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Summary</h4>
                    <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
                      {review.summary}
                    </div>
                  </div>
                )}

                {/* Reasoning Trace */}
                <ReasoningTrace
                  agentStepsJson={review.agentSteps}
                  modelUsed={review.modelUsed}
                  tokensUsed={review.tokensUsed}
                />

                {/* Comments */}
                {review.comments && review.comments.length > 0 ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">
                      Review Comments ({review.comments.length})
                    </h4>
                    {review.comments.map((comment, idx) => (
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
                ) : review.status === 'completed' ? (
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
                onClick={() => onDelete(review.id)}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRefresh(review.id)}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
