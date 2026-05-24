'use client';

import { GitPullRequest, Settings, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardTab } from '@/components/dashboard/dashboard-tab';
import { ManualReviewTab } from '@/components/dashboard/manual-review-tab';
import { SettingsTab } from '@/components/settings/settings-tab';
import { ReviewDetailDialog } from '@/components/review-detail-dialog';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { useReviews } from '@/hooks/use-reviews';
import { useReviewDetail } from '@/hooks/use-review-detail';
import { formatDate } from '@/lib/format';

export default function Home() {
  const {
    reviews,
    loading,
    page,
    totalPages,
    statusFilter,
    setPage,
    setStatusFilter,
    fetchReviews,
    stats,
  } = useReviews();

  const {
    selectedReview,
    detailOpen,
    setDetailOpen,
    detailLoading,
    openReviewDetail,
    deleteReview,
  } = useReviewDetail();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/auth/login';
    } catch {
      window.location.href = '/auth/login';
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header onRefresh={fetchReviews} onLogout={handleLogout} />

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

          <TabsContent value="dashboard" className="space-y-6">
            <DashboardTab
              reviews={reviews}
              loading={loading}
              page={page}
              totalPages={totalPages}
              statusFilter={statusFilter}
              stats={stats}
              setPage={setPage}
              setStatusFilter={setStatusFilter}
              openReviewDetail={openReviewDetail}
              formatDate={formatDate}
            />
          </TabsContent>

          <TabsContent value="review" className="space-y-6">
            <ManualReviewTab onReviewTriggered={fetchReviews} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <SettingsTab onLogout={handleLogout} />
          </TabsContent>
        </Tabs>
      </main>

      <Footer />

      <ReviewDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        review={selectedReview}
        loading={detailLoading}
        onDelete={(reviewId) => deleteReview(reviewId, fetchReviews)}
        onRefresh={(reviewId) => {
          fetchReviews();
          openReviewDetail(reviewId);
        }}
        formatDate={formatDate}
      />
    </div>
  );
}
