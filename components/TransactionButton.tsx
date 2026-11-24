'use client';

import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useConnection } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { Button } from '@/components/ui/button';
import { TxErrorBanner } from '@/components/TxErrorBanner';
import { isBroadcastTxHash } from '@/lib/utils/wallet-error';

interface TransactionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  isSuccess?: boolean;
  error?: unknown;
  txHash?: `0x${string}`;
  label?: string;
  loadingLabel?: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  /** When true, disconnected state shows a disabled action button (use topbar connect). */
  suppressConnectPrompt?: boolean;
}

export function TransactionButton({
  onClick,
  disabled,
  isLoading,
  isSuccess,
  error,
  txHash,
  label = 'Submit Transaction',
  loadingLabel,
  variant = 'default',
  size = 'default',
  suppressConnectPrompt = false,
}: TransactionButtonProps) {
  const { isConnected } = useConnection();
  const { open } = useAppKit();

  if (!isConnected) {
    if (suppressConnectPrompt) {
      return (
        <Button
          variant="outline"
          size={size}
          onClick={() => void open({ view: 'Connect' })}
          title="Connect wallet in the top bar to submit"
        >
          Connect wallet
        </Button>
      );
    }
    return (
      <Button
        variant="outline"
        size={size}
        onClick={() => void open({ view: 'Connect' })}
      >
        Connect Wallet
      </Button>
    );
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
        {error != null && <AlertCircle className="h-4 w-4" />}
        {isLoading
          ? isBroadcastTxHash(txHash)
            ? 'Confirming...'
            : (loadingLabel ?? 'Waiting for wallet...')
          : isSuccess
            ? 'Success'
            : label}
      </Button>
      {txHash && (
        <p className="text-xs text-muted-foreground break-all">
          Tx: {txHash}
        </p>
      )}
      {error != null && <TxErrorBanner error={error} className="text-xs" />}
    </div>
  );
}
