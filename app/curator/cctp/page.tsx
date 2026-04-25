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
  FINALITY_THRESHOLD,
  MESSAGE_TRANSMITTER_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_ABI,
  TOKEN_MESSENGER_V2_ABI,
  USDC_DECIMALS,
  chainSupportsVersion,
  getCctpChainById,
  getMessageTransmitter,
  getTokenMessenger,
  isChainDisabled,
  isV2Only,
  type CctpChain,
  type CctpVersion,
  type TransferSpeed,
} from '@/lib/cctp/constants';
import {
  addressToBytes32,
  extractMessageFromReceipt,
  fetchAttestation,
  fetchAttestationV2,
  fetchTransferFee,
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
  cctpVersion: CctpVersion;
  transferSpeed: TransferSpeed;
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
        description="Burn native USDC on one chain, mint it on another. Powered by Circle's Cross-Chain Transfer Protocol V2 with Fast Transfer support."
      >
        <CctpInner />
      </AppShell>
    </AuthGuard>
  );
}

function CctpInner() {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();

  const [cctpVersion, setCctpVersion] = useState<CctpVersion>('v2');
  const [transferSpeed, setTransferSpeed] = useState<TransferSpeed>('fast');

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
    setCctpVersion(saved.cctpVersion ?? 'v2');
    setTransferSpeed(saved.transferSpeed ?? 'fast');
    setStep(saved.step);
  }, []);

  const sourceChain = useMemo(() => getCctpChainById(sourceChainId)!, [sourceChainId]);
  const destChain = useMemo(() => getCctpChainById(destChainId)!, [destChainId]);

  // Auto-switch to V2 if either chain is V2-only (e.g. HyperEVM)
  useEffect(() => {
    if (step !== 'form') return;
    if (isV2Only(sourceChain) || isV2Only(destChain)) {
      setCctpVersion('v2');
    }
  }, [sourceChain, destChain, step]);

  const activeTokenMessenger = getTokenMessenger(sourceChain, cctpVersion);
  const activeMessageTransmitterSrc = getMessageTransmitter(sourceChain, cctpVersion);
  const activeMessageTransmitterDst = getMessageTransmitter(destChain, cctpVersion);

  const disabledReason = sourceChain.disabledReason ?? destChain.disabledReason ?? null;

  const versionMismatch =
    !chainSupportsVersion(sourceChain, cctpVersion) ||
    !chainSupportsVersion(destChain, cctpVersion);

  const chainsSupported =
    !isChainDisabled(sourceChain) &&
    !isChainDisabled(destChain) &&
    !versionMismatch &&
    Boolean(sourceChain.usdc && activeTokenMessenger && activeMessageTransmitterSrc) &&
    Boolean(activeMessageTransmitterDst);

  // V2 fee estimate
  const { data: feeEstimate } = useQuery({
    queryKey: ['cctp-fee', sourceChain.domain, destChain.domain, cctpVersion],
    queryFn: () => fetchTransferFee(sourceChain.domain, destChain.domain),
    enabled: cctpVersion === 'v2' && step === 'form' && chainsSupported,
    staleTime: 60_000,
  });

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
      address && activeTokenMessenger
        ? [address, activeTokenMessenger]
        : undefined,
    chainId: sourceChainId,
    query: {
      enabled:
        Boolean(address) &&
        Boolean(sourceChain.usdc) &&
        Boolean(activeTokenMessenger) &&
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

  // After the burn tx confirms, extract message (V1) or just advance (V2).
  useEffect(() => {
    if (step !== 'burn') return;
    if (!writeReceipt) return;
    if (!burnTxHash) setBurnTxHash(pendingWriteHash as Hex);

    if (cctpVersion === 'v2') {
      // V2: no need to extract from receipt — the attestation API takes the txHash directly
      setStep('attest');
      persist({
        sourceChainId,
        destChainId,
        recipient: recipient as Address,
        amountRaw: amountRaw.toString(),
        burnTxHash: (pendingWriteHash as Hex) ?? burnTxHash,
        step: 'attest',
        cctpVersion,
        transferSpeed,
      });
      resetWrite();
      return;
    }

    // V1: extract MessageSent event from receipt
    if (!activeMessageTransmitterSrc) return;
    const extracted = extractMessageFromReceipt(writeReceipt, activeMessageTransmitterSrc);
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
        cctpVersion,
        transferSpeed,
      });
      resetWrite();
    }
  }, [
    writeReceipt,
    step,
    burnTxHash,
    pendingWriteHash,
    activeMessageTransmitterSrc,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
    cctpVersion,
    transferSpeed,
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

  // ------------- Poll Circle attestation (V1 or V2) -------------

  // V1 attestation polling (uses messageHash)
  const { data: attestationResultV1 } = useQuery({
    queryKey: ['cctp-attestation-v1', messageHash],
    queryFn: async () => {
      if (!messageHash) return null;
      return fetchAttestation(messageHash);
    },
    enabled: step === 'attest' && cctpVersion === 'v1' && Boolean(messageHash),
    refetchInterval: 10_000,
  });

  // V2 attestation polling (uses sourceDomain + txHash)
  const activeBurnTxHash = burnTxHash ?? pendingWriteHash;
  const { data: attestationResultV2 } = useQuery({
    queryKey: ['cctp-attestation-v2', sourceChain.domain, activeBurnTxHash],
    queryFn: async () => {
      if (!activeBurnTxHash) return null;
      return fetchAttestationV2(sourceChain.domain, activeBurnTxHash as Hex);
    },
    enabled: step === 'attest' && cctpVersion === 'v2' && Boolean(activeBurnTxHash),
    refetchInterval: cctpVersion === 'v2' && transferSpeed === 'fast' ? 3_000 : 10_000,
  });

  // V1: advance on attestation complete
  useEffect(() => {
    if (step !== 'attest' || cctpVersion !== 'v1') return;
    if (!attestationResultV1) return;
    if (attestationResultV1.status === 'complete' && attestationResultV1.attestation) {
      setAttestation(attestationResultV1.attestation);
      setStep('claim');
      persist({
        sourceChainId,
        destChainId,
        recipient: recipient as Address,
        amountRaw: amountRaw.toString(),
        burnTxHash,
        message,
        messageHash,
        attestation: attestationResultV1.attestation,
        step: 'claim',
        cctpVersion,
        transferSpeed,
      });
    }
  }, [
    attestationResultV1,
    step,
    cctpVersion,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
    burnTxHash,
    message,
    messageHash,
    transferSpeed,
  ]);

  // V2: advance on attestation complete
  useEffect(() => {
    if (step !== 'attest' || cctpVersion !== 'v2') return;
    if (!attestationResultV2) return;
    if (
      attestationResultV2.status === 'complete' &&
      attestationResultV2.message &&
      attestationResultV2.attestation
    ) {
      setMessage(attestationResultV2.message);
      setAttestation(attestationResultV2.attestation);
      setStep('claim');
      persist({
        sourceChainId,
        destChainId,
        recipient: recipient as Address,
        amountRaw: amountRaw.toString(),
        burnTxHash,
        message: attestationResultV2.message,
        attestation: attestationResultV2.attestation,
        step: 'claim',
        cctpVersion,
        transferSpeed,
      });
    }
  }, [
    attestationResultV2,
    step,
    cctpVersion,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
    burnTxHash,
    transferSpeed,
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

  const fireBurn = useCallback(() => {
    if (!activeTokenMessenger || !sourceChain.usdc) return;

    if (cctpVersion === 'v2') {
      const maxFee = transferSpeed === 'fast'
        ? (feeEstimate?.fee ?? 100000n) // default 0.10 USDC if fee query failed
        : 0n; // Standard Transfer — no fee

      writeContract({
        address: activeTokenMessenger,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: 'depositForBurn',
        args: [
          amountRaw,
          destChain.domain,
          addressToBytes32(recipient as Address),
          sourceChain.usdc,
          '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex, // destinationCaller — anyone
          maxFee,
          FINALITY_THRESHOLD[transferSpeed],
        ],
        chainId: sourceChainId,
      });
    } else {
      writeContract({
        address: activeTokenMessenger,
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
    }
  }, [
    activeTokenMessenger,
    sourceChain.usdc,
    cctpVersion,
    transferSpeed,
    feeEstimate,
    writeContract,
    amountRaw,
    destChain.domain,
    recipient,
    sourceChainId,
  ]);

  const startTransfer = useCallback(async () => {
    if (!address) return;
    if (!recipientIsValid) return;
    if (amountRaw <= 0n) return;
    if (amountRaw > balance) return;
    if (sourceChainId === destChainId) return;
    if (!chainsSupported) return;
    if (!sourceChain.usdc || !activeTokenMessenger) return;

    if (!(await ensureChain(sourceChainId))) return;

    if (allowance < amountRaw) {
      setStep('approve');
      writeContract({
        address: sourceChain.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [activeTokenMessenger, amountRaw],
        chainId: sourceChainId,
      });
      return;
    }
    setStep('burn');
    fireBurn();
    persist({
      sourceChainId,
      destChainId,
      recipient: recipient as Address,
      amountRaw: amountRaw.toString(),
      step: 'burn',
      cctpVersion,
      transferSpeed,
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
    activeTokenMessenger,
    recipient,
    chainsSupported,
    fireBurn,
    cctpVersion,
    transferSpeed,
  ]);

  const doBurn = useCallback(async () => {
    if (!activeTokenMessenger || !sourceChain.usdc) return;
    if (!(await ensureChain(sourceChainId))) return;
    fireBurn();
    persist({
      sourceChainId,
      destChainId,
      recipient: recipient as Address,
      amountRaw: amountRaw.toString(),
      step: 'burn',
      cctpVersion,
      transferSpeed,
    });
  }, [
    ensureChain,
    sourceChainId,
    destChainId,
    sourceChain,
    activeTokenMessenger,
    amountRaw,
    recipient,
    fireBurn,
    cctpVersion,
    transferSpeed,
  ]);

  const doClaim = useCallback(async () => {
    if (!message || !attestation) return;
    if (!activeMessageTransmitterDst) return;
    if (!(await ensureChain(destChainId))) return;
    const abi = cctpVersion === 'v2' ? MESSAGE_TRANSMITTER_V2_ABI : MESSAGE_TRANSMITTER_ABI;
    writeContract({
      address: activeMessageTransmitterDst,
      abi,
      functionName: 'receiveMessage',
      args: [message, attestation],
      chainId: destChainId,
    });
  }, [message, attestation, ensureChain, destChainId, activeMessageTransmitterDst, writeContract, cctpVersion]);

  // Manually re-extract message from receipt (V1 only) or just advance (V2)
  const [fetchingReceipt, setFetchingReceipt] = useState(false);
  const recoverFromBurnTx = useCallback(async () => {
    if (!burnTxHash) return;

    if (cctpVersion === 'v2') {
      // V2 doesn't need receipt extraction — just advance to attest
      setStep('attest');
      persist({
        sourceChainId,
        destChainId,
        recipient: recipient as Address,
        amountRaw: amountRaw.toString(),
        burnTxHash,
        step: 'attest',
        cctpVersion,
        transferSpeed,
      });
      return;
    }

    // V1: extract from receipt
    if (!sourcePublicClient || !activeMessageTransmitterSrc) return;
    setFetchingReceipt(true);
    try {
      const receipt = await sourcePublicClient.getTransactionReceipt({ hash: burnTxHash });
      const extracted = extractMessageFromReceipt(receipt, activeMessageTransmitterSrc);
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
          cctpVersion,
          transferSpeed,
        });
      }
    } finally {
      setFetchingReceipt(false);
    }
  }, [
    burnTxHash,
    sourcePublicClient,
    activeMessageTransmitterSrc,
    sourceChainId,
    destChainId,
    recipient,
    amountRaw,
    cctpVersion,
    transferSpeed,
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
          {/* V1 / V2 toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Protocol:</span>
            <div className="inline-flex rounded-md border border-input bg-muted/40">
              <button
                type="button"
                onClick={() => step === 'form' && setCctpVersion('v2')}
                disabled={step !== 'form'}
                className={`px-3 py-1 text-xs font-medium transition ${
                  cctpVersion === 'v2'
                    ? 'bg-primary text-primary-foreground rounded-l-md'
                    : 'text-muted-foreground hover:text-foreground rounded-l-md'
                }`}
              >
                V2
              </button>
              <button
                type="button"
                onClick={() => {
                  if (step !== 'form') return;
                  if (isV2Only(sourceChain) || isV2Only(destChain)) return;
                  setCctpVersion('v1');
                }}
                disabled={step !== 'form' || isV2Only(sourceChain) || isV2Only(destChain)}
                className={`px-3 py-1 text-xs font-medium transition ${
                  cctpVersion === 'v1'
                    ? 'bg-primary text-primary-foreground rounded-r-md'
                    : 'text-muted-foreground hover:text-foreground rounded-r-md'
                }`}
              >
                V1 (Legacy)
              </button>
            </div>
            {cctpVersion === 'v1' && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                V1 will be deprecated July 2026
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr]">
            <ChainSelect
              label="From"
              value={sourceChainId}
              onChange={setSourceChainId}
              exclude={destChainId}
              cctpVersion={cctpVersion}
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
              cctpVersion={cctpVersion}
            />
          </div>

          {/* V2 transfer speed selector */}
          {cctpVersion === 'v2' && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Speed:</span>
                <div className="inline-flex rounded-md border border-input bg-muted/40">
                  <button
                    type="button"
                    onClick={() => step === 'form' && setTransferSpeed('fast')}
                    disabled={step !== 'form'}
                    className={`px-3 py-1 text-xs font-medium transition rounded-l-md ${
                      transferSpeed === 'fast'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Fast (~seconds)
                  </button>
                  <button
                    type="button"
                    onClick={() => step === 'form' && setTransferSpeed('standard')}
                    disabled={step !== 'form'}
                    className={`px-3 py-1 text-xs font-medium transition rounded-r-md ${
                      transferSpeed === 'standard'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Standard (~minutes)
                  </button>
                </div>
              </div>
              {feeEstimate && feeEstimate.fee > 0n && transferSpeed === 'fast' && (
                <span className="text-xs text-muted-foreground">
                  Est. fee: {formatUnits(feeEstimate.fee, USDC_DECIMALS)} USDC
                </span>
              )}
              {transferSpeed === 'standard' && (
                <span className="text-xs text-muted-foreground">No fee (gas only)</span>
              )}
            </div>
          )}

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

          {versionMismatch && !disabledReason && (
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {cctpVersion === 'v1'
                  ? `${isV2Only(sourceChain) ? sourceChain.name : destChain.name} does not support CCTP V1. Switch to V2 to use this chain.`
                  : `${sourceChain.name} or ${destChain.name} does not support CCTP V2.`}
              </p>
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
                  (cctpVersion === 'v2' ? activeBurnTxHash : messageHash) ? (
                    <Pending
                      label={
                        cctpVersion === 'v2' && transferSpeed === 'fast'
                          ? 'Polling Circle (~5–20 sec)'
                          : cctpVersion === 'v2'
                          ? 'Polling Circle (~1–15 min)'
                          : 'Polling Circle (~10–20 min)'
                      }
                    />
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
            wrapping, no external liquidity.
          </p>

          <div>
            <p className="mb-1 font-medium text-foreground">V2 vs V1 (Legacy)</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>V2 (default)</strong> — uses{' '}
                <code className="rounded bg-muted px-1">TokenMessengerV2</code> +{' '}
                <code className="rounded bg-muted px-1">MessageTransmitterV2</code> contracts.
                Supports <strong>Fast Transfer</strong> (~seconds, variable fee) and{' '}
                <strong>Standard Transfer</strong> (~minutes, gas only). Attestation is fetched in
                a single API call using the transaction hash — no manual message extraction needed.
              </li>
              <li>
                <strong>V1 (Legacy)</strong> — original contracts with 4-param{' '}
                <code className="rounded bg-muted px-1">depositForBurn</code>. Standard-speed
                only (~10–20 min). <strong>Deprecated July 2026.</strong> Kept for fallback
                compatibility.
              </li>
            </ul>
          </div>

          <div>
            <p className="mb-1 font-medium text-foreground">Transfer steps</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <strong>Approve.</strong> ERC-20 approval of USDC so the CCTP TokenMessenger can
                burn the transfer amount. Skipped if allowance is large enough.
              </li>
              <li>
                <strong>Burn.</strong> Call{' '}
                <code className="rounded bg-muted px-1">depositForBurn</code> on the source
                TokenMessenger{cctpVersion === 'v2' ? 'V2' : ''}. USDC is burned on the source
                chain.
              </li>
              <li>
                <strong>Circle attestation.</strong> Circle signs the transfer.
                {cctpVersion === 'v2' && transferSpeed === 'fast'
                  ? ' Fast Transfer: ~5–20 seconds.'
                  : cctpVersion === 'v2'
                  ? ' Standard Transfer: ~1–15 minutes.'
                  : ' V1: ~10–20 minutes (source chain finality).'}
              </li>
              <li>
                <strong>Claim (mint).</strong> Call{' '}
                <code className="rounded bg-muted px-1">receiveMessage</code> on the destination
                MessageTransmitter{cctpVersion === 'v2' ? 'V2' : ''}. Native USDC is minted to
                the recipient.
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
              V1 + V2: Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche.
              V2-only: HyperEVM (available when V2 mode is selected).
              Not yet supported: Solana (non-EVM). See{' '}
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

          <div className="flex gap-3">
            <a
              href="https://developers.circle.com/cctp/references/contract-interfaces"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              CCTP V2 docs <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="https://developers.circle.com/cctp/migration-from-v1-to-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Migration guide <ExternalLink className="h-3 w-3" />
            </a>
          </div>
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
  cctpVersion,
}: {
  label: string;
  value: number;
  onChange: (chainId: number) => void;
  exclude?: number;
  cctpVersion: CctpVersion;
}) {
  const selected: CctpChain | undefined = CCTP_CHAINS.find((c) => c.chainId === value);
  const selectedDisabled = selected ? isChainDisabled(selected) : false;
  const selectedUnsupported = selected ? !chainSupportsVersion(selected, cctpVersion) : false;
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {CCTP_CHAINS.map((c) => {
            const disabled = c.chainId === exclude || isChainDisabled(c);
            const noVersion = !chainSupportsVersion(c, cctpVersion);
            return (
              <option key={c.chainId} value={c.chainId} disabled={disabled}>
                {c.name}
                {isChainDisabled(c) ? ' (not supported)' : noVersion ? ` (no ${cctpVersion.toUpperCase()})` : ''}
              </option>
            );
          })}
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
        {selectedUnsupported && !selectedDisabled && (
          <Badge
            variant="outline"
            className="border-amber-500/50 font-mono text-[10px] text-amber-700 dark:text-amber-300"
          >
            no {cctpVersion.toUpperCase()}
          </Badge>
        )}
      </div>
    </div>
  );
}
