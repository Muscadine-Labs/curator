/**
 * Compact wallet / viem write errors for UI — avoid dumping full Request Arguments.
 */

export type WalletErrorSummary = {
  /** One-line message shown by default. */
  summary: string;
  /** Full technical text (expandable). */
  details: string | null;
  isRejection: boolean;
};

function rawErrorText(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const anyErr = error as Error & { shortMessage?: string; details?: string };
    const parts = [anyErr.shortMessage, anyErr.message, anyErr.details].filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0
    );
    return [...new Set(parts)].join('\n');
  }
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

export function isWalletRejection(error: unknown): boolean {
  const text = rawErrorText(error).toLowerCase();
  return (
    text.includes('user rejected') ||
    text.includes('user denied') ||
    text.includes('user cancelled') ||
    text.includes('user canceled') ||
    text.includes('rejected the request') ||
    text.includes('action_rejected') ||
    text.includes('action_cancelled') ||
    text.includes('4001') ||
    text.includes('request rejected')
  );
}

/** True after the wallet broadcast a hash — empty `0x` / progress placeholders do not count. */
export function isBroadcastTxHash(hash?: string | null): boolean {
  return typeof hash === 'string' && hash.startsWith('0x') && hash.length >= 66;
}

/** Vault V2 / adapter / Morpho Blue custom errors that commonly bubble through writes. */
const REVERT_SUMMARIES: Array<{ match: RegExp; summary: string }> = [
  {
    match: /0xa4875a49/i,
    summary: 'Allocate exceeds a Morpho Blue market supply cap.',
  },
  {
    match: /0x96e13529|marketnotcreated/i,
    summary: 'That Morpho Blue market does not exist on this chain.',
  },
  {
    match: /0x133c5cc8|notinadapterregistry/i,
    summary: 'Adapter is not in this vault’s adapter registry.',
  },
  {
    match: /0x7cceae25|approvereverted/i,
    summary: 'Token approve reverted while the adapter moved assets.',
  },
  {
    match: /0x7d577764|approvereturnedfalse/i,
    summary: 'Token approve returned false while the adapter moved assets.',
  },
  {
    match: /0xbdeafe07|absolutecapnotdecreasing/i,
    summary: 'New absolute cap must be lower than the current cap.',
  },
  {
    match: /0x04c27fbf|relativecapnotdecreasing/i,
    summary: 'New relative cap must be lower than the current cap.',
  },
  {
    match: /0xd91ff208|dataalreadypending/i,
    summary: 'That change is already pending — wait for the timelock or revoke it first.',
  },
  {
    match: /0x4616e4af|absolutecapexceeded/i,
    summary:
      'Allocate exceeds an absolute cap. Morpho counts market + adapter + collateral IDs, and accrued interest counts toward the cap — reduce the target or raise the cap.',
  },
  {
    match: /0x44e1772c|relativecapexceeded/i,
    summary:
      'Allocate exceeds a relative cap (market, adapter, or collateral). Reduce the target or raise the relative cap.',
  },
  {
    match: /0xbb1a23b9|zeroabsolutecap/i,
    summary: 'This market is not listed (absolute cap is zero). Increase the cap before allocating.',
  },
  {
    match: /0xace2a47e|transferreverted/i,
    summary:
      'Allocate failed: not enough idle cash at that step. Min other markets first, then Max — or reduce the target.',
  },
  {
    match: /0xe65b7a77|transferfromreverted/i,
    summary:
      'Deallocate failed: the adapter could not return assets (liquidity or approval). Reduce the amount or Min the row.',
  },
  {
    match: /0xbb55fd27|insufficientliquidity/i,
    summary: 'Not enough market liquidity to withdraw. Min the row instead of a full exit.',
  },
  {
    match: /0x82b42900|unauthorized/i,
    summary: 'This wallet is not authorized for that vault action (allocator / curator / owner).',
  },
  {
    match: /0xf521d159|notadapter/i,
    summary: 'That adapter is not enabled on this vault.',
  },
  {
    match: /0xba0d87b5|zeroallocation/i,
    summary: 'Cannot deallocate a market with zero booked allocation.',
  },
  {
    match: /0x515b7cd9|cannotsendassets/i,
    summary: 'Send-assets gate blocked this deposit (sender is not whitelisted).',
  },
  {
    match: /0x5cb045db|invaliddata/i,
    summary:
      'Adapter data is invalid — vault adapters need empty data; Blue markets need encoded market params.',
  },
  {
    match: /0xff8d32ad|sharepriceaboveone/i,
    summary: 'Market share price is above 1; this adapter cannot supply into it.',
  },
  {
    match: /0x58ec95f2|loanassetmismatch/i,
    summary: 'Market loan token does not match the vault asset.',
  },
  {
    match: /0x6a7ca6c7|irmmismatch/i,
    summary: 'Market IRM is not the adapter’s AdaptiveCurveIRM.',
  },
  {
    match: /0x1ea942a8|datanottimelocked/i,
    summary: 'Nothing is pending for that calldata — submit it first and wait out the timelock.',
  },
  {
    match: /0x621e25c3|timelocknotexpired/i,
    summary: 'Timelock has not expired yet — wait before accepting.',
  },
  {
    match: /0xa844d937|absolutecapnotincreasing/i,
    summary: 'New absolute cap must be greater than or equal to the current cap.',
  },
  {
    match: /0x8433449d|relativecapnotincreasing/i,
    summary: 'New relative cap must be greater than or equal to the current cap.',
  },
];

function summaryForRevert(details: string): string | null {
  for (const entry of REVERT_SUMMARIES) {
    if (entry.match.test(details)) return entry.summary;
  }
  return null;
}

/**
 * Prefer a short headline; keep the full viem dump only as expandable details.
 */
export function summarizeWalletError(error: unknown): WalletErrorSummary {
  const details = rawErrorText(error).trim() || null;

  if (isWalletRejection(error)) {
    return {
      summary: 'Cancelled.',
      details: null,
      isRejection: true,
    };
  }

  if (details) {
    const revertSummary = summaryForRevert(details);
    if (revertSummary) {
      return {
        summary: revertSummary,
        details,
        isRejection: false,
      };
    }

    // First non-empty line, strip "Details:" prefixes for the summary.
    const firstLine =
      details
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !/^docs:/i.test(l) && !/^version:/i.test(l)) ??
      'Transaction failed.';

    const summary =
      firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine;
    const needsDetails = details.includes('\n') || details.length > summary.length + 20;

    return {
      summary,
      details: needsDetails ? details : null,
      isRejection: false,
    };
  }

  return {
    summary: 'Transaction failed. Please try again.',
    details: null,
    isRejection: false,
  };
}
