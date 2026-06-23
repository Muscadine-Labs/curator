/** Google Sheet IDs for Muscadine Ledger by state and year. */
export const MUSCADINE_LEDGER_SHEET_IDS: Record<string, Record<string, string>> = {
  Georgia: {
    '2026': '183cy9VlCD9csxmz2_5ocEIGfNbckdeR-tZLiGggxGns',
  },
  Wyoming: {
    '2025': '1Hr2i6WcfN4I6xRmyMtbk1NNmiWfOfBYsegBVX3nd13w',
    '2026': '1jAhmmt2pte6ClciasZma--_I0IPIn4u0AvHDeU31rGM',
  },
};

/** Years with a configured sheet for the given state (newest first). */
export function getMuscadineLedgerYears(state: string): string[] {
  return Object.keys(MUSCADINE_LEDGER_SHEET_IDS[state] ?? {}).sort((a, b) => b.localeCompare(a));
}

export const MUSCADINE_LEDGER_SHEET_NAMES = ['Expenses', 'Income'] as const;

/** Tab GID in the Google Sheets URL (#gid=…). */
export const MUSCADINE_LEDGER_SHEET_GIDS: Record<string, string> = {
  Expenses: '0',
  Income: '0',
};
