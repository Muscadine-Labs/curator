'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  isAddress,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { usePublicClient } from 'wagmi';
import { ExternalLink, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TransactionButton } from '@/components/TransactionButton';
import { useVaultWrite } from '@/lib/hooks/useVaultWrite';
import {
  getAddressScanUrl,
  getScanUrlForChain,
  MORPHO_ORACLE_PORTAL_URL,
} from '@/lib/constants';
import {
  computeMarketId,
  DEFAULT_LLTV_WAD,
  formatLltvPercent,
  isZeroAddress,
  LLTV_PRESETS,
  lookupMorphoOracle,
  morphoBlueCreateMarketAbi,
  morphoOracleFactoryAbi,
  type OracleLookup,
} from '@/lib/morpho/blue-create-market';
import { getCreateMarketDeployment } from '@/lib/morpho/create-market-deployments';
import {
  lookupErc20TokenMeta,
  type Erc20TokenLookup,
} from '@/lib/morpho/erc20-token-meta';
import {
  oracleAddressFromReceipt,
  parseOracleSafePayload,
  type ParsedOracleDeployTx,
} from '@/lib/morpho/oracle-safe-payload';
import { useCuratorNetwork } from '@/lib/network/CuratorNetworkContext';
import {
  curatorBlueMarketHref,
  morphoMarketHref,
} from '@/lib/morpho/morpho-app-links';

type ValidationState = {
  checking: boolean;
  irmEnabled: boolean | null;
  lltvEnabled: boolean | null;
  marketExists: boolean | null;
  marketId: Hex | null;
  error: string | null;
};

const emptyValidation: ValidationState = {
  checking: false,
  irmEnabled: null,
  lltvEnabled: null,
  marketExists: null,
  marketId: null,
  error: null,
};

function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block space-y-1">
      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {children}
      </span>
      {hint ? (
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function TokenMetaLine({ lookup }: { lookup: Erc20TokenLookup }) {
  if (lookup.status === 'idle') return null;
  if (lookup.status === 'loading') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Resolving token…
      </p>
    );
  }
  if (lookup.status === 'invalid') {
    return (
      <p className="text-xs text-red-600 dark:text-red-400">{lookup.error}</p>
    );
  }
  return (
    <p className="text-xs text-slate-600 dark:text-slate-300">
      <span className="font-medium text-slate-900 dark:text-slate-100">
        {lookup.token.symbol}
      </span>
      <span className="text-slate-400 dark:text-slate-500"> · </span>
      {lookup.token.name}
      <span className="text-slate-400 dark:text-slate-500">
        {' '}
        · {lookup.token.decimals} decimals
      </span>
    </p>
  );
}

function OracleMetaLine({ lookup }: { lookup: OracleLookup }) {
  if (lookup.status === 'idle') return null;
  if (lookup.status === 'loading') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking oracle…
      </p>
    );
  }
  if (lookup.status === 'invalid') {
    return (
      <p className="text-xs text-red-600 dark:text-red-400">{lookup.error}</p>
    );
  }
  return (
    <p className="text-xs text-slate-600 dark:text-slate-300">
      Contract found
      {lookup.factoryDeployed === true ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> · </span>
          <span className="text-emerald-700 dark:text-emerald-400">
            MorphoChainlinkOracleV2 (factory)
          </span>
        </>
      ) : lookup.factoryDeployed === false ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> · </span>
          <span className="text-amber-700 dark:text-amber-400">
            Not from Morpho factory — verify carefully
          </span>
        </>
      ) : null}
    </p>
  );
}

const IDLE_TOKEN: Erc20TokenLookup = { status: 'idle' };
const LOADING_TOKEN: Erc20TokenLookup = { status: 'loading' };
const IDLE_ORACLE: OracleLookup = { status: 'idle' };
const LOADING_ORACLE: OracleLookup = { status: 'loading' };

function useDebouncedLookup<T>(
  raw: string,
  delayMs: number,
  lookup: (value: string) => Promise<T>,
  idle: T,
  loading: T
): T {
  const [state, setState] = useState<T>(idle);

  useEffect(() => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setState(idle);
      return;
    }
    setState(loading);
    let cancelled = false;
    const t = setTimeout(() => {
      void lookup(trimmed).then((result) => {
        if (!cancelled) setState(result);
      });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [raw, delayMs, lookup, idle, loading]);

  return state;
}

export function CreateMarketForm() {
  const { chainId, networkName, isWalletOnSelectedChain, ready } = useCuratorNetwork();
  const deployment = useMemo(() => {
    try {
      return getCreateMarketDeployment(chainId);
    } catch {
      return null;
    }
  }, [chainId]);
  const publicClient = usePublicClient({ chainId: ready ? chainId : undefined });
  const {
    write,
    txHash,
    isLoading,
    isSuccess,
    error: writeError,
    reset,
  } = useVaultWrite({ chainId });

  const {
    write: writeOracle,
    txHash: oracleTxHash,
    receipt: oracleReceipt,
    isLoading: oracleDeploying,
    isSuccess: oracleDeploySuccess,
    error: oracleWriteError,
    reset: resetOracleWrite,
  } = useVaultWrite({ chainId });

  const [loanToken, setLoanToken] = useState('');
  const [collateralToken, setCollateralToken] = useState('');
  const [oracle, setOracle] = useState('');
  const [oraclePayloadJson, setOraclePayloadJson] = useState('');
  const [oraclePayloadError, setOraclePayloadError] = useState<string | null>(null);
  const [parsedOracleTx, setParsedOracleTx] = useState<ParsedOracleDeployTx | null>(null);
  const [irm, setIrm] = useState<string>('');
  const [lltv, setLltv] = useState<string>(DEFAULT_LLTV_WAD);
  const [validation, setValidation] = useState<ValidationState>(emptyValidation);
  /** Market id from the last successful create (survives if validation is re-run). */
  const [createdMarketId, setCreatedMarketId] = useState<Hex | null>(null);
  /** Bumps on each validation run so slower RPC replies cannot overwrite newer results. */
  const validationGenRef = useRef(0);

  // Reset chain-specific fields when top-bar network changes (or deployment resolves).
  useEffect(() => {
    setLoanToken('');
    setCollateralToken('');
    setIrm(deployment?.adaptiveCurveIrm ?? '');
    setOracle('');
    setOraclePayloadJson('');
    setOraclePayloadError(null);
    setParsedOracleTx(null);
    setValidation(emptyValidation);
    setCreatedMarketId(null);
    reset();
    resetOracleWrite();
    // Intentionally keyed on chainId (not deployment object / reset fn identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset form only on network change
  }, [chainId]);

  const resolveLoan = useCallback(
    async (value: string): Promise<Erc20TokenLookup> => {
      if (!publicClient) {
        return { status: 'invalid', error: `${networkName} RPC client not ready.` };
      }
      return lookupErc20TokenMeta(publicClient, value);
    },
    [publicClient, networkName]
  );

  const resolveCollateral = useCallback(
    async (value: string): Promise<Erc20TokenLookup> => {
      if (!publicClient) {
        return { status: 'invalid', error: `${networkName} RPC client not ready.` };
      }
      return lookupErc20TokenMeta(publicClient, value);
    },
    [publicClient, networkName]
  );

  const resolveOracle = useCallback(
    async (value: string): Promise<OracleLookup> => {
      if (!publicClient) {
        return { status: 'invalid', error: `${networkName} RPC client not ready.` };
      }
      if (!deployment) {
        return { status: 'invalid', error: `createMarket is not configured for ${networkName}.` };
      }
      return lookupMorphoOracle(
        publicClient,
        value,
        deployment.chainlinkOracleFactory
      );
    },
    [publicClient, networkName, deployment]
  );

  const loanMeta = useDebouncedLookup(
    loanToken,
    400,
    resolveLoan,
    IDLE_TOKEN,
    LOADING_TOKEN
  );
  const collateralMeta = useDebouncedLookup(
    collateralToken,
    400,
    resolveCollateral,
    IDLE_TOKEN,
    LOADING_TOKEN
  );
  const oracleMeta = useDebouncedLookup(
    oracle,
    400,
    resolveOracle,
    IDLE_ORACLE,
    LOADING_ORACLE
  );

  const onOraclePayloadChange = useCallback(
    (raw: string) => {
      setOraclePayloadJson(raw);
      setOraclePayloadError(null);
      setParsedOracleTx(null);
      if (!raw.trim()) return;
      if (!deployment) {
        setOraclePayloadError(`createMarket is not configured for ${networkName}.`);
        return;
      }
      const result = parseOracleSafePayload(raw, {
        expectedChainId: deployment.chainId,
        expectedFactory: deployment.chainlinkOracleFactory,
        networkName: deployment.name,
      });
      if (!result.ok) {
        setOraclePayloadError(result.error);
        return;
      }
      setParsedOracleTx(result.tx);
    },
    [deployment, networkName]
  );

  const handleDeployOracle = useCallback(async () => {
    if (!parsedOracleTx) return;
    resetOracleWrite();
    setOraclePayloadError(null);
    const a = parsedOracleTx.args;
    try {
      await writeOracle({
        address: parsedOracleTx.factory,
        abi: morphoOracleFactoryAbi,
        functionName: 'createMorphoChainlinkOracleV2',
        args: [
          a.baseVault,
          a.baseVaultConversionSample,
          a.baseFeed1,
          a.baseFeed2,
          a.baseTokenDecimals,
          a.quoteVault,
          a.quoteVaultConversionSample,
          a.quoteFeed1,
          a.quoteFeed2,
          a.quoteTokenDecimals,
          a.salt,
        ],
        value: parsedOracleTx.value,
      });
    } catch (err) {
      setOraclePayloadError(
        err instanceof Error ? err.message : 'Oracle deploy failed.'
      );
    }
  }, [parsedOracleTx, resetOracleWrite, writeOracle]);

  useEffect(() => {
    if (!oracleDeploySuccess || !oracleReceipt) return;
    const deployed = oracleAddressFromReceipt(oracleReceipt);
    if (deployed) {
      setOracle(deployed);
      setOraclePayloadError(null);
    } else {
      setOraclePayloadError(
        'Deploy succeeded but CreateMorphoChainlinkOracleV2 event was not found in the receipt.'
      );
    }
  }, [oracleDeploySuccess, oracleReceipt]);

  const parsedParams = useMemo(() => {
    try {
      if (
        !isAddress(loanToken) ||
        !isAddress(collateralToken) ||
        !isAddress(oracle) ||
        !isAddress(irm)
      ) {
        return null;
      }
      const lltvBig = BigInt(lltv.trim());
      // Morpho allows 0% LLTV; must be < 100% (WAD).
      if (lltvBig < 0n || lltvBig >= 10n ** 18n) {
        return null;
      }
      return {
        loanToken: getAddress(loanToken) as Address,
        collateralToken: getAddress(collateralToken) as Address,
        oracle: getAddress(oracle) as Address,
        irm: getAddress(irm) as Address,
        lltv: lltvBig,
      };
    } catch {
      return null;
    }
  }, [loanToken, collateralToken, oracle, irm, lltv]);

  const tokensReady =
    loanMeta.status === 'ok' &&
    collateralMeta.status === 'ok' &&
    oracleMeta.status === 'ok' &&
    loanMeta.token.address.toLowerCase() !==
      collateralMeta.token.address.toLowerCase();

  const runValidation = useCallback(async () => {
    const gen = ++validationGenRef.current;

    if (!deployment) {
      setValidation({
        ...emptyValidation,
        error: `createMarket is not configured for ${networkName}.`,
      });
      return;
    }
    if (!parsedParams) {
      setValidation({
        ...emptyValidation,
        error: 'Enter valid addresses and an LLTV WAD (e.g. 860000000000000000 for 86%).',
      });
      return;
    }
    if (isZeroAddress(parsedParams.oracle)) {
      setValidation({
        ...emptyValidation,
        error: 'Oracle cannot be the zero address. Deploy or paste a MorphoChainlinkOracleV2.',
      });
      return;
    }
    if (!publicClient) {
      setValidation({
        ...emptyValidation,
        error: `${networkName} RPC client not ready. Check network / Alchemy key.`,
      });
      return;
    }
    if (!tokensReady) {
      setValidation({
        ...emptyValidation,
        error: 'Loan, collateral, and oracle must resolve to valid contracts first.',
      });
      return;
    }

    const marketId = computeMarketId(parsedParams);
    setValidation({
      ...emptyValidation,
      checking: true,
      marketId,
    });

    try {
      const [irmOk, lltvOk, existing] = await Promise.all([
        publicClient.readContract({
          address: deployment.morpho,
          abi: morphoBlueCreateMarketAbi,
          functionName: 'isIrmEnabled',
          args: [parsedParams.irm],
        }),
        publicClient.readContract({
          address: deployment.morpho,
          abi: morphoBlueCreateMarketAbi,
          functionName: 'isLltvEnabled',
          args: [parsedParams.lltv],
        }),
        publicClient.readContract({
          address: deployment.morpho,
          abi: morphoBlueCreateMarketAbi,
          functionName: 'idToMarketParams',
          args: [marketId],
        }),
      ]);

      if (gen !== validationGenRef.current) return;

      const existingLoan = (existing as readonly [Address, Address, Address, Address, bigint])[0];
      const marketExists = !isZeroAddress(existingLoan);

      setValidation({
        checking: false,
        irmEnabled: Boolean(irmOk),
        lltvEnabled: Boolean(lltvOk),
        marketExists,
        marketId,
        error: null,
      });
    } catch (err) {
      if (gen !== validationGenRef.current) return;
      setValidation({
        ...emptyValidation,
        marketId,
        error: err instanceof Error ? err.message : 'Validation failed',
      });
    }
  }, [parsedParams, publicClient, tokensReady, networkName, deployment]);

  useEffect(() => {
    if (!parsedParams || !tokensReady || !deployment) {
      validationGenRef.current += 1;
      setValidation((prev) =>
        prev.checking ? { ...prev, checking: false } : prev
      );
      return;
    }
    const t = setTimeout(() => {
      void runValidation();
    }, 400);
    return () => {
      clearTimeout(t);
      // Invalidate in-flight RPC from the previous debounce window.
      validationGenRef.current += 1;
    };
  }, [parsedParams, tokensReady, deployment, runValidation]);

  const canCreate =
    !!deployment &&
    !!parsedParams &&
    tokensReady &&
    validation.irmEnabled === true &&
    validation.lltvEnabled === true &&
    validation.marketExists === false &&
    !validation.checking &&
    isWalletOnSelectedChain;

  const handleCreate = async () => {
    if (!parsedParams || !canCreate || !deployment) return;
    const marketId = computeMarketId(parsedParams);
    setValidation((prev) => ({ ...prev, marketId }));
    reset();
    await write({
      address: deployment.morpho,
      abi: morphoBlueCreateMarketAbi,
      functionName: 'createMarket',
      args: [parsedParams],
    });
  };

  // Stamp market id only after a successful create (not on wallet reject).
  useEffect(() => {
    if (!isSuccess || !parsedParams) return;
    setCreatedMarketId(computeMarketId(parsedParams));
  }, [isSuccess, parsedParams]);

  // Clear sticky success UI when MarketParams change after a create.
  const paramsFingerprint = parsedParams
    ? `${parsedParams.loanToken}-${parsedParams.collateralToken}-${parsedParams.oracle}-${parsedParams.irm}-${parsedParams.lltv}`
    : '';
  const prevParamsRef = useRef(paramsFingerprint);
  useEffect(() => {
    if (prevParamsRef.current === paramsFingerprint) return;
    prevParamsRef.current = paramsFingerprint;
    if (!createdMarketId && !isSuccess) return;
    setCreatedMarketId(null);
    reset();
  }, [paramsFingerprint, createdMarketId, isSuccess, reset]);

  const lltvDisplay = parsedParams ? formatLltvPercent(parsedParams.lltv) : '—';
  const explorerTxHref =
    txHash != null
      ? `${getScanUrlForChain(chainId)}/tx/${txHash}`
      : null;

  const successMarketId = isSuccess
    ? (createdMarketId ??
      validation.marketId ??
      (parsedParams ? computeMarketId(parsedParams) : null))
    : null;
  const morphoCreatedHref = successMarketId
    ? morphoMarketHref(successMarketId, chainId)
    : null;
  const curatorCreatedHref = successMarketId
    ? curatorBlueMarketHref(successMarketId, chainId)
    : null;

  const pairLabel =
    loanMeta.status === 'ok' && collateralMeta.status === 'ok'
      ? `${collateralMeta.token.symbol} / ${loanMeta.token.symbol}`
      : null;

  if (!deployment) {
    return (
      <AppShell
        title="Create Morpho Market"
        description={`Morpho Blue createMarket is not available on ${networkName}.`}
        backHref="/morpho"
        backLabel="Morpho Tools"
      >
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unsupported network</AlertTitle>
          <AlertDescription>
            No Morpho Blue / AdaptiveCurveIRM / oracle factory addresses are configured for{' '}
            {networkName}. Switch the top-bar network to Base, Ethereum, HyperEVM, Robinhood, or
            Polygon.
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Create Morpho Market"
      description={`Paste token + oracle addresses, validate on-chain, then call Morpho Blue createMarket on ${networkName}. Use the top-bar network toggle (works without a wallet).`}
      backHref="/morpho"
      backLabel="Morpho Tools"
      actions={
        <Button asChild variant="outline" size="sm">
          <a
            href={MORPHO_ORACLE_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2"
          >
            Oracle Portal
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Oracle from oracles.morpho.dev</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              On the portal: build feeds → export <strong>Gnosis Safe Payload</strong> →
              paste it below → <strong>Deploy oracle</strong> with your connected wallet.
              We read the create event and fill the oracle address automatically. You can
              still paste an already-deployed oracle address by hand.
            </p>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Deploy oracle (portal JSON)</CardTitle>
            <CardDescription>
              Paste the Safe Transaction Builder JSON from{' '}
              <a
                href={MORPHO_ORACLE_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                oracles.morpho.dev
              </a>
              . We call MorphoChainlinkOracleV2Factory on {networkName} and auto-fill the address.
              Payload chainId must match the top-bar network ({chainId}).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              id="oraclePayload"
              value={oraclePayloadJson}
              onChange={(e) => onOraclePayloadChange(e.target.value)}
              placeholder='{ "version": "1.0", "chainId": "8453", "transactions": [ … ] }'
              spellCheck={false}
              rows={8}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            {parsedOracleTx ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Parsed createMorphoChainlinkOracleV2 → factory{' '}
                <span className="font-mono">{parsedOracleTx.factory.slice(0, 10)}…</span>
                {' · '}
                base decimals {parsedOracleTx.args.baseTokenDecimals.toString()}
                {' · '}
                quote decimals {parsedOracleTx.args.quoteTokenDecimals.toString()}
              </p>
            ) : null}
            {oraclePayloadError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{oraclePayloadError}</p>
            ) : null}
            {oracleWriteError ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {oracleWriteError instanceof Error
                  ? oracleWriteError.message
                  : String(oracleWriteError)}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <TransactionButton
                onClick={() => void handleDeployOracle()}
                disabled={!parsedOracleTx || !isWalletOnSelectedChain}
                isLoading={oracleDeploying}
                isSuccess={oracleDeploySuccess && !!oracle}
                error={null}
                txHash={oracleTxHash}
                label="Deploy oracle"
              />
              <Button asChild variant="outline" size="sm">
                <a
                  href={MORPHO_ORACLE_PORTAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  Open portal
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>MarketParams</CardTitle>
            <CardDescription>
              Morpho Blue · {networkName} ·{' '}
              <a
                href={getAddressScanUrl(chainId, deployment.morpho)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {deployment.morpho.slice(0, 10)}…
              </a>
              {pairLabel ? ` · ${pairLabel}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="loanToken" hint="Asset borrowers receive / vault lends">
                Loan token
              </FieldLabel>
              <Input
                id="loanToken"
                value={loanToken}
                onChange={(e) => setLoanToken(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <TokenMetaLine lookup={loanMeta} />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="collateralToken" hint="Asset borrowers post as collateral">
                Collateral token
              </FieldLabel>
              <Input
                id="collateralToken"
                value={collateralToken}
                onChange={(e) => setCollateralToken(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <TokenMetaLine lookup={collateralMeta} />
            </div>

            {loanMeta.status === 'ok' &&
            collateralMeta.status === 'ok' &&
            loanMeta.token.address.toLowerCase() ===
              collateralMeta.token.address.toLowerCase() ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Loan and collateral tokens must be different.
              </p>
            ) : null}

            <div className="space-y-2">
              <FieldLabel
                htmlFor="oracle"
                hint="Auto-filled after Deploy oracle, or paste an existing MorphoChainlinkOracleV2 address"
              >
                Oracle
              </FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="oracle"
                  value={oracle}
                  onChange={(e) => setOracle(e.target.value.trim())}
                  placeholder="0x…"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                <Button asChild variant="secondary" className="shrink-0">
                  <a
                    href={MORPHO_ORACLE_PORTAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    Open portal
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
              <OracleMetaLine lookup={oracleMeta} />
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="irm"
                hint={`AdaptiveCurveIRM for ${networkName}`}
              >
                IRM
              </FieldLabel>
              <Input
                id="irm"
                value={irm}
                onChange={(e) => setIrm(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIrm(deployment.adaptiveCurveIrm)}
              >
                Use AdaptiveCurveIRM
              </Button>
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="lltv" hint="WAD units — 1e18 = 100%">
                LLTV {parsedParams ? `(${lltvDisplay})` : ''}
              </FieldLabel>
              <Input
                id="lltv"
                value={lltv}
                onChange={(e) => setLltv(e.target.value.trim())}
                placeholder="860000000000000000"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {LLTV_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={lltv === p.wad ? 'default' : 'outline'}
                    onClick={() => setLltv(p.wad)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              On-chain checks
              {validation.checking ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              ) : null}
            </CardTitle>
            <CardDescription>
              isIrmEnabled, isLltvEnabled, marketExists — plus ERC-20 / oracle contract checks above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {validation.marketId ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Market ID
                </p>
                <p className="mt-1 break-all font-mono text-sm">{validation.marketId}</p>
                {(() => {
                  const href = morphoMarketHref(validation.marketId, chainId);
                  return href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 underline underline-offset-2 dark:text-blue-400"
                    >
                      Open in Morpho app
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null;
                })()}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <StatusBadge label="IRM enabled" value={validation.irmEnabled} />
              <StatusBadge label="LLTV enabled" value={validation.lltvEnabled} />
              <StatusBadge
                label="Market free"
                value={
                  validation.marketExists == null
                    ? null
                    : !validation.marketExists
                }
                failLabel="Already exists"
              />
            </div>

            {validation.error ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {validation.error}
              </p>
            ) : null}

            {validation.marketExists ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Market already exists</AlertTitle>
                <AlertDescription>
                  These MarketParams already resolve to an on-chain market. Change
                  oracle, LLTV, or tokens to create a new market id.
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runValidation()}
              disabled={validation.checking || !parsedParams || !tokensReady}
            >
              Re-check
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create on-chain</CardTitle>
            <CardDescription>
              Calls <code className="text-xs">Morpho.createMarket(marketParams)</code> on{' '}
              {networkName}. Gas only — no tokens required.
              {!isWalletOnSelectedChain ? (
                <span className="mt-1 block text-amber-700 dark:text-amber-400">
                  Connect a wallet on {networkName} (or flip the top-bar network) to create.
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TransactionButton
              onClick={() => void handleCreate()}
              disabled={!canCreate}
              isLoading={isLoading}
              isSuccess={isSuccess}
              error={writeError}
              txHash={txHash}
              label="Create market"
            />
            {isSuccess ? (
              <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Market created
                </p>
                {successMarketId ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400/80">
                      Market ID
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-emerald-900 dark:text-emerald-200">
                      {successMarketId}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {morphoCreatedHref ? (
                    <a
                      href={morphoCreatedHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-emerald-800 underline underline-offset-2 dark:text-emerald-300"
                    >
                      Open in Morpho app
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  {curatorCreatedHref ? (
                    <a
                      href={curatorCreatedHref}
                      className="inline-flex items-center gap-1 text-emerald-800 underline underline-offset-2 dark:text-emerald-300"
                      title="May be empty until Morpho indexes the new market"
                    >
                      View in Curator
                    </a>
                  ) : null}
                  {explorerTxHref ? (
                    <a
                      href={explorerTxHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-800 underline underline-offset-2 dark:text-emerald-300"
                    >
                      View on explorer
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatusBadge({
  label,
  value,
  failLabel = 'No',
}: {
  label: string;
  value: boolean | null;
  failLabel?: string;
}) {
  if (value == null) {
    return (
      <Badge variant="outline" className="gap-1">
        {label}: —
      </Badge>
    );
  }
  if (value) {
    return (
      <Badge variant="secondary" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        {label}: yes
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" />
      {label}: {failLabel}
    </Badge>
  );
}
