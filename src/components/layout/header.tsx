'use client';

import { GitPullRequest, Shield, RefreshCw, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  onRefresh: () => void;
  onLogout: () => void;
}

export function Header({ onRefresh, onLogout }: HeaderProps) {
  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary rounded-lg p-2">
            <GitPullRequest className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">CodeSentinel</h1>
            <p className="text-xs text-muted-foreground">AI-Powered Code Review Agent</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Shield className="h-3 w-3" />
            Admin
          </Badge>
          <Button variant="ghost" size="icon" onClick={onRefresh} title="Refresh reviews">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            title="Sign out"
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
