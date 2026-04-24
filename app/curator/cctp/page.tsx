'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Address,
  type Hex,
  formatUnits,
  isAddress,
  parseUnits,
} from 'viem';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

import { AppShell } from '@/components/layout/AppShell';
import { AuthGuard } from '@/components/AuthGuard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

import {
  CCTP_CHAINS,
  ERC20_ABI,
  MESSAGE_TRANSMITTER_ABI,
  TOKEN_MESSENGER_ABI,
  USDC_DECIMALS,
  getCctpChainById,
  isChainDisabled,
  type CctpChain,
} from '@/lib/cctp/constants';
import {
  addressToBytes32,
  extractMessageFromReceipt,
  fetchAttestation,
} from '@/lib/cctp/attestation';

type Step = 'form' | 'approve' | 'burn' | 'attest' | 'claim' | 'done';

interface PersistedTransfer {
  sourceChainId: number;
  destChainId: number;
  recipient: Address;
  amountRaw: string; // stringified bigint
  burnTxHash?: Hex;
  message?: Hex;
  messageHash?: Hex;
  attestation?: Hex;
  claimTxHash?: Hex;
  step: Step;
}

const STORAGE_KEY = 'cctp:pendingTransfer';

function loadPersisted(): PersistedTransfer | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedTransfer;
  } catch {
    return null;
  }
}

function persist(t: PersistedTransfer | null) {
  if (typeof window === 'undefined') return;
  if (t === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

export default function CctpPage() {
  return (
    <AuthGuard>
      <AppShell
        title="USDC Cross-Chain Transfer (CCTP)"
        description="Burn native USDC on one chain, mint it on another. Powered by Circle's Cross-Chain Transfer Protocol (free — only gas)."
      >
        <CctpInner />
      </AppShell>
    </AuthGuard>
  );
}

function CctpInner() {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();

  const [sourceChainId, setSourceChainId] = useState<number>(CCTP_CHAINS[4].chainId); // Base
  const [destChainId, setDestChainId] = useState<number>(CCTP_CHAINS[0].chainId); // Ethereum
  const [recipient, setRecipient] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  const [step, setStep] = useState<Step>('form');
  const [burnTxHash, setBurnTxHash] = useState<Hex | undefined>(undefined);
  const [message, setMessage] = useState<Hex | undefined>(undefined);
  const [messageHash, setMessageHash] = useState<Hex | undefined>(undefined);
  const [attestation, setAttestation] = useState<Hex | undefined>(undefined);
  const [claimTxHash, setClaimTxHash] = useState<Hex | undefined>(undefined);

  useEffect(() => {
    if (address && !recipient) setRecipient(address);
  }, [address, recipient]);

  // Rehydrate a pending transfer on mount so a user who refreshed mid-flow can resume.
  useEffect(() => {
    const saved = loadPersisted();
    if (!saved) return;
    setSourceChainId(saved.sourceChainId);
    setDestChainId(saved.destChainId);
    setRecipient(saved.recipient);
    setAmount(formatUnits(BigInt(saved.amountRaw), USDC_DECIMALS));
    if (saved.burnTxHash) setBurnTxHash(saved.burnTxHash);
    if (saved.message) setMessage(saved.message);
    if (saved.messageHash) setMessageHash(saved.messageHash);
    if (saved.attestation) setAttestation(saved.attestation);
    if (saved.claimTxHash) setClaimTxHash(saved.claimTxHash);
    setStep(saved.step);
  }, []);

  const sourceChain = useMemo(() => getCctpChainById(sourceChainId)!, [sourceChainId]);
  const destChain = useMemo(() => getCctpChainById(destChainId)!, [destChainId]);

  const disabledReason = sourceChain.disabledReason ?? destChain.disabledReason ?? null;
  const chainsSupported =
    !isChainDisabled(sourceChain) &&
    !isChainDisabled(destChain) &&
    Boolean(sourceChain.usdc && sourceChain.tokenMessenger && sourceChain.messageTransmitter) &&
    Boolean(destChain.messageTransmitter);

  const amountRaw = useMemo(() => {
    if (!amount) return 0n;
    try {
      return parseUnits(amount, USDC_DECIMALS);
    } catch {
      return 0n;
    }
  }, [amount]);

  const recipientIsValid = recipient !== '' && isAddress(recipient);

  // ------------- Read USDC balance + allowance on the source chain -------------
  const { data: balanceData } = useReadContract({
    address: sourceChain.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: sourceChainId,
    query: { enabled: Boolean(address) && Boolean(sourceChain.usdc) && chainsSupported },
  });
  const balance = (balanceData as bigint | undefined) ?? 0n;

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: sourceChain.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args:
      address && sourceChain.tokenMessenger
        ? [address, sourceChain.tokenMessenger]
        : undefined,
    chainId: sourceChainId,
    query: {
      enabled:
        Boolean(address) &&
        Boolean(sourceChain.usdc) &&
        Boolean(sourceChain.tokenMessenger) &&
        chainsSupported,
    },
  });
  const allowance = (allowanceData as bigint | undefined) ?? 0n;

  // ------------- Write helpers (approve / burn / claim) -------------
  const {
    writeContract,
    data: pendingWriteHash,
    isPending: isWriting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  // ------------- Receipt watchers -------------
  const { data: writeReceipt, isLoading: isConfirmingWrite } =
    useWaitForTransactionReceipt({
      hash: pendingWriteHash,
      chainId: step === 'claim' ? destChainId : sourceChainId,
    });

  const sourcePublicClient = usePublicClient({ chainId: sourceChainId });

  // After the burn tx confirms, extract the CCTP message + hash.
  useEffect(() => {
    if (step !== 'burn') return;
    if (!writeReceipt) return;
    if (!sourceChain.messageTransmitter) return;
    if (!burnTxHash) setBurnTxHash(pendingWriteHash as Hex);
    const extracted = extractMessageFromReceipt(
      writeReceipt,
      sourceChain.messageTransmitter
    );
    if (extracted) {
      setMessage(extracted.message);
      setMessageHash(extracted.messageHash);
      setStep('attest');
      persist({
        sourceChainId,
        destChainId,
        recipient: recipient as Address,
        amountRaw: amountRaw.toString(),
        burnTxHash: (pendingWriteHash as Hex) ?? burnTxHash,
        message: extracted.message,
        messageHash: extracted.messageHash,
        step: 'attest',
      });
      resetWrite();
    }
  }, [
    writeReceipt,
    step,
    burnTxHash,
    pendingWriteHash,
    sourceChain.messageTransmitter,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
    resetWrite,
  ]);

  // After the approve tx confirms, advance to burn.
  useEffect(() => {
    if (step !== 'approve') return;
    if (!writeReceipt) return;
    refetchAllowance();
    setStep('burn');
    resetWrite();
  }, [writeReceipt, step, refetchAllowance, resetWrite]);

  // After the claim tx confirms, we're done.
  useEffect(() => {
    if (step !== 'claim') return;
    if (!writeReceipt) return;
    setClaimTxHash(pendingWriteHash as Hex);
    setStep('done');
    persist(null);
    resetWrite();
  }, [writeReceipt, step, pendingWriteHash, resetWrite]);

  // ------------- Poll Circle attestation -------------
  const { data: attestationResult } = useQuery({
    queryKey: ['cctp-attestation', messageHash],
    queryFn: async () => {
      if (!messageHash) return null;
      return fetchAttestation(messageHash);
    },
    enabled: step === 'attest' && Boolean(messageHash),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (step !== 'attest') return;
    if (!attestationResult) return;
    if (attestationResult.status === 'complete' && attestationResult.attestation) {
      setAttestation(attestationResult.attestation);
      setStep('claim');
      persist({
        sourceChainId,
        destChainId,
        recipient: recipient as Address,
        amountRaw: amountRaw.toString(),
        burnTxHash,
        message,
        messageHash,
        attestation: attestationResult.attestation,
        step: 'claim',
      });
    }
  }, [
    attestationResult,
    step,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
    burnTxHash,
    message,
    messageHash,
  ]);

  // ------------- Actions -------------
  const ensureChain = useCallback(
    async (targetChainId: number) => {
      if (currentChainId === targetChainId) return true;
      try {
        await switchChainAsync({ chainId: targetChainId });
        return true;
      } catch {
        return false;
      }
    },
    [currentChainId, switchChainAsync]
  );

  const startTransfer = useCallback(async () => {
    if (!address) return;
    if (!recipientIsValid) return;
    if (amountRaw <= 0n) return;
    if (amountRaw > balance) return;
    if (sourceChainId === destChainId) return;
    if (!chainsSupported) return;
    if (!sourceChain.usdc || !sourceChain.tokenMessenger) return;

    if (!(await ensureChain(sourceChainId))) return;

    if (allowance < amountRaw) {
      setStep('approve');
      writeContract({
        address: sourceChain.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [sourceChain.tokenMessenger, amountRaw],
        chainId: sourceChainId,
      });
      return;
    }
    setStep('burn');
    writeContract({
      address: sourceChain.tokenMessenger,
      abi: TOKEN_MESSENGER_ABI,
      functionName: 'depositForBurn',
      args: [
        amountRaw,
        destChain.domain,
        addressToBytes32(recipient as Address),
        sourceChain.usdc,
      ],
      chainId: sourceChainId,
    });
    persist({
      sourceChainId,
      destChainId,
      recipient: recipient as Address,
      amountRaw: amountRaw.toString(),
      step: 'burn',
    });
  }, [
    address,
    recipientIsValid,
    amountRaw,
    balance,
    sourceChainId,
    destChainId,
    allowance,
    ensureChain,
    writeContract,
    sourceChain,
    destChain,
    recipient,
    chainsSupported,
  ]);

  const doBurn = useCallback(async () => {
    if (!sourceChain.tokenMessenger || !sourceChain.usdc) return;
    if (!(await ensureChain(sourceChainId))) return;
    writeContract({
      address: sourceChain.tokenMessenger,
      abi: TOKEN_MESSENGER_ABI,
      functionName: 'depositForBurn',
      args: [
        amountRaw,
        destChain.domain,
        addressToBytes32(recipient as Address),
        sourceChain.usdc,
      ],
      chainId: sourceChainId,
    });
    persist({
      sourceChainId,
      destChainId,
      recipient: recipient as Address,
      amountRaw: amountRaw.toString(),
      step: 'burn',
    });
  }, [
    ensureChain,
    sourceChainId,
    destChainId,
    writeContract,
    sourceChain,
    destChain,
    amountRaw,
    recipient,
  ]);

  const doClaim = useCallback(async () => {
    if (!message || !attestation) return;
    if (!destChain.messageTransmitter) return;
    if (!(await ensureChain(destChainId))) return;
    writeContract({
      address: destChain.messageTransmitter,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: 'receiveMessage',
      args: [message, attestation],
      chainId: destChainId,
    });
  }, [message, attestation, ensureChain, destChainId, destChain, writeContract]);

  // Manually re-extract message from receipt (e.g. if a user landed on this page after burn and needs to resume)
  const [fetchingReceipt, setFetchingReceipt] = useState(false);
  const recoverFromBurnTx = useCallback(async () => {
    if (!burnTxHash || !sourcePublicClient) return;
    if (!sourceChain.messageTransmitter) return;
    setFetchingReceipt(true);
    try {
      const receipt = await sourcePublicClient.getTransactionReceipt({ hash: burnTxHash });
      const extracted = extractMessageFromReceipt(receipt, sourceChain.messageTransmitter);
      if (extracted) {
        setMessage(extracted.message);
        setMessageHash(extracted.messageHash);
        setStep('attest');
        persist({
          sourceChainId,
          destChainId,
          recipient: recipient as Address,
          amountRaw: amountRaw.toString(),
          burnTxHash,
          message: extracted.message,
          messageHash: extracted.messageHash,
          step: 'attest',
        });
      }
    } finally {
      setFetchingReceipt(false);
    }
  }, [
    burnTxHash,
    sourcePublicClient,
    sourceChain.messageTransmitter,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
  ]);

  const resetAll = useCallback(() => {
    setStep('form');
    setBurnTxHash(undefined);
    setMessage(undefined);
    setMessageHash(undefined);
    setAttestation(undefined);
    setClaimTxHash(undefined);
    resetWrite();
    persist(null);
  }, [resetWrite]);

  const swapChains = useCallback(() => {
    setSourceChainId(destChainId);
    setDestChainId(sourceChainId);
  }, [sourceChainId, destChainId]);

  // ------------- Render -------------
  if (!isConnected) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                Connect your wallet to start a cross-chain USDC transfer.
              </p>
              <ConnectButton />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const amountExceedsBalance = amountRaw > balance && balance > 0n;
  const canStart =
    step === 'form' &&
    sourceChainId !== destChainId &&
    recipientIsValid &&
    amountRaw > 0n &&
    !amountExceedsBalance &&
    chainsSupported;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownUp className="h-4 w-4" />
            Transfer USDC
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr]">
            <ChainSelect
              label="From"
              value={sourceChainId}
              onChange={setSourceChainId}
              exclude={destChainId}
            />
            <div className="flex items-end justify-center pb-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={swapChains}
                disabled={step !== 'form'}
                title="Swap chains"
              >
                <ArrowDownUp className="h-4 w-4" />
              </Button>
            </div>
            <ChainSelect
              label="To"
              value={destChainId}
              onChange={setDestChainId}
              exclude={sourceChainId}
            />
          </div>

          {disabledReason && (
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">
                  {isChainDisabled(sourceChain) ? sourceChain.name : destChain.name} is not yet supported for transfers.
                </p>
                <p>{disabledReason}</p>
                <p className="opacity-80">
                  The chain is listed for reference (CCTP domain{' '}
                  {isChainDisabled(sourceChain) ? sourceChain.domain : destChain.domain}) per
                  Circle&apos;s registry.
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Amount (USDC)</label>
              <button
                type="button"
                onClick={() => setAmount(formatUnits(balance, USDC_DECIMALS))}
                className="text-xs text-primary hover:underline"
                disabled={balance === 0n || step !== 'form'}
              >
                Balance: {formatUnits(balance, USDC_DECIMALS)} (max)
              </button>
            </div>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={step !== 'form'}
            />
            {amountExceedsBalance && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Amount exceeds balance on {sourceChain.name}.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Destination address (on {destChain.name})
            </label>
            <Input
              type="text"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={step !== 'form'}
            />
            {recipient && !recipientIsValid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">Invalid address.</p>
            )}
          </div>

          {step === 'form' && (
            <Button
              className="w-full"
              onClick={startTransfer}
              disabled={!canStart || isSwitching}
            >
              {isSwitching ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Switching network…
                </span>
              ) : (
                'Start transfer'
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {step !== 'form' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4" />
              Transfer progress
            </CardTitle>
            <Button type="button" variant="ghost" size="sm" onClick={resetAll}>
              Cancel / reset
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProgressStep
              label={`Approve USDC on ${sourceChain.name}`}
              state={stateForStep('approve', step)}
              txHash={step === 'approve' && pendingWriteHash ? pendingWriteHash : undefined}
              scanUrl={sourceChain.scanUrl}
              action={
                step === 'approve' && (isWriting || isConfirmingWrite) ? (
                  <Pending label={isWriting ? 'Confirm in wallet' : 'Waiting confirmations'} />
                ) : null
              }
            />

            <ProgressStep
              label={`Burn USDC on ${sourceChain.name}`}
              state={stateForStep('burn', step)}
              txHash={burnTxHash ?? (step === 'burn' ? pendingWriteHash : undefined)}
              scanUrl={sourceChain.scanUrl}
              action={
                step === 'burn' ? (
                  isWriting || isConfirmingWrite ? (
                    <Pending label={isWriting ? 'Confirm in wallet' : 'Waiting confirmations'} />
                  ) : (
                    <Button size="sm" onClick={doBurn}>
                      Burn now
                    </Button>
                  )
                ) : null
              }
            />

            <ProgressStep
              label="Circle attestation"
              state={stateForStep('attest', step)}
              action={
                step === 'attest' ? (
                  messageHash ? (
                    <Pending label="Polling Circle (~10–20 min)" />
                  ) : burnTxHash ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={recoverFromBurnTx}
                      disabled={fetchingReceipt}
                    >
                      {fetchingReceipt ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" /> Reading receipt
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <RefreshCcw className="h-3 w-3" /> Retry receipt read
                        </span>
                      )}
                    </Button>
                  ) : null
                ) : null
              }
            />

            <ProgressStep
              label={`Claim USDC on ${destChain.name}`}
              state={stateForStep('claim', step)}
              txHash={claimTxHash ?? (step === 'claim' ? pendingWriteHash : undefined)}
              scanUrl={destChain.scanUrl}
              action={
                step === 'claim' ? (
                  isWriting || isConfirmingWrite ? (
                    <Pending label={isWriting ? 'Confirm in wallet' : 'Waiting confirmations'} />
                  ) : (
                    <Button size="sm" onClick={doClaim}>
                      Claim now
                    </Button>
                  )
                ) : null
              }
            />

            {step === 'done' && (
              <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Transfer complete — USDC has been minted on {destChain.name}.
                <button
                  type="button"
                  onClick={resetAll}
                  className="ml-auto text-xs underline underline-offset-2"
                >
                  Start another
                </button>
              </div>
            )}

            {writeError && (
              <p className="break-all text-xs text-red-600 dark:text-red-400">
                {writeError.message?.slice(0, 300)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About CCTP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <p>
            CCTP is Circle&apos;s official cross-chain USDC protocol. USDC is burned on the source
            chain and an equal amount of native USDC is minted on the destination chain — no bridge
            wrapping, no external liquidity, no bridge fees. You only pay source + destination gas.
          </p>

          <div>
            <p className="mb-1 font-medium text-foreground">Transfer steps</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <strong>Approve.</strong> One-time ERC-20 approval of USDC on the source chain so
                the CCTP <code className="rounded bg-muted px-1">TokenMessenger</code> can spend
                the amount you&apos;re transferring. Skipped automatically if your allowance is
                already large enough.
              </li>
              <li>
                <strong>Burn.</strong> Call{' '}
                <code className="rounded bg-muted px-1">depositForBurn</code> on the source
                TokenMessenger. USDC is burned on the source chain and a{' '}
                <code className="rounded bg-muted px-1">MessageSent</code> event is emitted with
                the CCTP message describing the transfer.
              </li>
              <li>
                <strong>Circle attestation.</strong> Circle watches for the burn, waits for the
                source chain to finalize, and signs an attestation over the message hash.
                Typically <strong>10–20 minutes</strong> for standard transfers. This app polls
                Circle&apos;s Iris API every 10 seconds while you wait.
              </li>
              <li>
                <strong>Claim (mint).</strong> Call{' '}
                <code className="rounded bg-muted px-1">receiveMessage(message, attestation)</code>{' '}
                on the destination MessageTransmitter. Circle&apos;s contracts verify the
                signature and mint native USDC to the recipient address.
              </li>
            </ol>
            <p className="mt-2">
              You can close this page after the burn — the transfer is saved locally and will
              resume when you return.
            </p>
          </div>

          <div>
            <p className="mb-1 font-medium text-foreground">Supported networks</p>
            <p>
              Fully wired up (V1 burn-and-mint): Ethereum, Base, Arbitrum, Optimism, Polygon,
              Avalanche. Listed for reference but not yet usable here: HyperEVM (CCTP V2 only) and
              Solana (non-EVM — requires a Solana wallet). See{' '}
              <a
                href="https://developers.circle.com/cctp/concepts/supported-chains-and-domains"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Circle&apos;s full chain registry <ExternalLink className="h-3 w-3" />
              </a>
              .
            </p>
          </div>

          <a
            href="https://developers.circle.com/stablecoins/docs/cctp-getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Circle CCTP docs <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function stateForStep(target: Step, current: Step): 'done' | 'active' | 'pending' {
  const order: Step[] = ['form', 'approve', 'burn', 'attest', 'claim', 'done'];
  const ti = order.indexOf(target);
  const ci = order.indexOf(current);
  if (current === 'done') return 'done';
  if (ci > ti) return 'done';
  if (ci === ti) return 'active';
  return 'pending';
}

function ProgressStep({
  label,
  state,
  txHash,
  scanUrl,
  action,
}: {
  label: string;
  state: 'done' | 'active' | 'pending';
  txHash?: Hex;
  scanUrl?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-border py-1 pl-3 md:flex-row md:items-center md:justify-between md:gap-3">
      <div className="flex items-center gap-2">
        <StateDot state={state} />
        <span
          className={
            state === 'done'
              ? 'text-sm text-foreground'
              : state === 'active'
              ? 'text-sm font-medium text-foreground'
              : 'text-sm text-muted-foreground'
          }
        >
          {label}
        </span>
        {txHash && scanUrl && (
          <a
            href={`${scanUrl}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
          >
            tx <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function StateDot({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  }
  if (state === 'active') {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

function Pending({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" /> {label}
    </span>
  );
}

function ChainSelect({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string;
  value: number;
  onChange: (chainId: number) => void;
  exclude?: number;
}) {
  const selected: CctpChain | undefined = CCTP_CHAINS.find((c) => c.chainId === value);
  const selectedDisabled = selected ? isChainDisabled(selected) : false;
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {CCTP_CHAINS.map((c) => (
            <option key={c.chainId} value={c.chainId} disabled={c.chainId === exclude}>
              {c.name}
              {isChainDisabled(c) ? ' (not yet supported)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        <Badge variant="secondary" className="font-mono text-[10px]">
          Domain {selected?.domain}
        </Badge>
        {selected && (
          <Badge variant="outline" className="font-mono text-[10px]">
            CCTP {selected.cctpVersion.toUpperCase()}
          </Badge>
        )}
        {selectedDisabled && (
          <Badge
            variant="outline"
            className="border-amber-500/50 font-mono text-[10px] text-amber-700 dark:text-amber-300"
          >
            disabled
          </Badge>
        )}
      </div>
    </div>
  );
}
