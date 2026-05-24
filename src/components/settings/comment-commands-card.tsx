'use client';

import { MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const commands = [
  { cmd: '/review', desc: 'Start a full review' },
  { cmd: '/recheck', desc: 'Re-review after changes' },
  { cmd: '/check', desc: 'Quick check' },
  { cmd: '/re-review', desc: 'Full re-review' },
  { cmd: '/fix', desc: 'Get fix suggestions' },
  { cmd: '/explain', desc: 'Explain the code' },
  { cmd: '/ignore', desc: 'Suppress file reviews' },
  { cmd: '/help', desc: 'Show commands help' },
];

export function CommentCommandsCard() {
  return (
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
            {commands.map((item) => (
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
  );
}
