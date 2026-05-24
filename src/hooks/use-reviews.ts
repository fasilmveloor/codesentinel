'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { Review } from '@/types';

export interface ReviewStats {
  totalReviews: number;
  approved: number;
  changesRequested: number;
  active: number;
}

export function useReviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [stats, setStats] = useState<ReviewStats>({ totalReviews: 0, approved: 0, changesRequested: 0, active: 0 });

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
      if (data.stats) setStats(data.stats);
    } catch {
      toast.error('Failed to fetch reviews');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    const hasActive = reviews.some((r) => r.status === 'pending' || r.status === 'reviewing');
    if (!hasActive) return;
    const interval = setInterval(() => {
      fetchReviews();
    }, 5000);
    return () => clearInterval(interval);
  }, [reviews, fetchReviews]);

  return { reviews, loading, page, totalPages, statusFilter, setPage, setStatusFilter, fetchReviews, stats };
}
