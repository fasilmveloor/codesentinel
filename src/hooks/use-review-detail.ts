'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { ReviewDetail } from '@/types';

export function useReviewDetail() {
  const [selectedReview, setSelectedReview] = useState<ReviewDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const deleteReview = async (reviewId: string, onSuccess?: () => void) => {
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed to delete review');
        return;
      }
      toast.success('Review deleted');
      onSuccess?.();
      setDetailOpen(false);
    } catch {
      toast.error('Failed to delete review');
    }
  };

  return { selectedReview, detailOpen, setDetailOpen, detailLoading, openReviewDetail, deleteReview };
}
