'use client';

import { useState } from 'react';
import { KeyRound, Loader2, LogOut, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface AccountCardProps {
  onLogout: () => void;
}

export function AccountCard({ onLogout }: AccountCardProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

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

  return (
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
            onClick={onLogout}
            className="text-destructive hover:text-destructive"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
