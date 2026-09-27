import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { accountsFromGateLog } from '@/lib/morpho/send-assets-gate-roster.server';

const WHITELISTER = '0x2Ed45BB3542d06d81D117acd8A561e910A17A618';
const ACCOUNT = '0xD437c78a6bA1F42Dca908F3759ab8B8A42Af4D82';

describe('accountsFromGateLog', () => {
  it('reads both indexed addresses from a SetIsWhitelisted log', () => {
    const event = parseAbiItem(
      'event SetIsWhitelisted(address indexed whitelister, address indexed account, bool newIsWhitelisted)'
    );
    const topics = encodeEventTopics({
      abi: [event],
      eventName: 'SetIsWhitelisted',
      args: { whitelister: WHITELISTER, account: ACCOUNT },
    }).flatMap((topic) => (Array.isArray(topic) ? topic : [topic]));
    const data = encodeAbiParameters([{ type: 'bool' }], [true]);
    expect(
      accountsFromGateLog({ data, topics: [...topics, null, null] })
        .map((address) => address.toLowerCase())
        .sort()
    ).toEqual([ACCOUNT.toLowerCase(), WHITELISTER.toLowerCase()].sort());
  });

  it('ignores logs that are not roster events', () => {
    expect(
      accountsFromGateLog({ data: '0x', topics: [`0x${'ab'.repeat(32)}`] })
    ).toEqual([]);
  });
});
