'use client';

import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '@/components/ui/button';

interface TransactionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  isSuccess?: boolean;
  error?: Error | null;
  txHash?: `0x${string}`;
  label?: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
}

export function TransactionButton({
  onClick,
  disabled,
  isLoading,
  isSuccess,
  error,
  txHash,
  label = 'Submit Transaction',
  variant = 'default',
  size = 'default',
}: TransactionButtonProps) {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectButton.Custom>
      {({ openConnectModal }) => (
        <Button variant="outline" size={size} onClick={openConnectModal}>
          Connect Wallet
        </Button>
      )}
    </ConnectButton.Custom>;
  }

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={disabled || isLoading}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {isSuccess && <CheckCircle2 className="h-4 w-4" />}
        {error && <AlertCircle className="h-4 w-4" />}
        {isLoading ? 'Confirming...' : isSuccess ? 'Success' : label}
      </Button>
      {txHash && (
        <p className="text-xs text-muted-foreground break-all">
          Tx: {txHash}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 break-all">
          {error.message?.slice(0, 200)}
        </p>
      )}
    </div>
  );
}
