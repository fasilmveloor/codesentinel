'use client';

import {
  GitPullRequest,
  CheckCircle,
  AlertTriangle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/badges';
import { ScoreBadge } from '@/components/badges';
import { StatCard } from '@/components/stat-card';
import type { Review } from '@/types';
import type { ReviewStats } from '@/hooks/use-reviews';

interface DashboardTabProps {
  reviews: Review[];
  loading: boolean;
  page: number;
  totalPages: number;
  statusFilter: string;
  stats: ReviewStats;
  setPage: (page: number) => void;
  setStatusFilter: (filter: string) => void;
  openReviewDetail: (reviewId: string) => void;
  formatDate: (dateStr: string) => string;
}

export function DashboardTab({
  reviews,
  loading,
  page,
  totalPages,
  statusFilter,
  stats,
  setPage,
  setStatusFilter,
  openReviewDetail,
  formatDate,
}: DashboardTabProps) {
  // Use server-provided stats (accurate across ALL reviews, not just current page)
  const totalReviews = stats.totalReviews;
  const approved = stats.approved;
  const changesRequested = stats.changesRequested;

  return (
    <>
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
          value={stats.active}
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
                      {reviews.map((review) => (
                        <TableRow
                          key={review.id}
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
                        </TableRow>
                      ))}
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
    </>
  );
}
