import { describe, expect, it } from 'vitest'

import { deriveReleaseTransactions, parseShareworksReleasesCsv } from './releases'

const sampleCsv = `RSU Releases
Period Start Date,Period End Date,Grant Date,Grant Number,Grant Type,Grant Name,Grant Reason,Release Date,Shares Vested,Shares Sold-To-Cover,Shares Held,Value,,Fair Market Value Per Share,,Sale Date (Sell-To-Cover only),Sale Price Per Share,,Sale Proceeds,,Sell-To-Cover Amount,,Release Reference Number
01-Jan-2025,31-Dec-2025,20-Sep-2024,GRANT-001,Share Units (RSU),Example Grant A,Ongoing,13-Feb-2025,10,4,6,"$3,160.00",USD,$316.00,USD,14-Feb-2025,$312.0903,USD,"$1,248.36",USD,"$1,248.24",USD,RELREF-001
,,,,,,,,10,4,6,"$3,160.00",USD,,,,,,"$1,248.36",USD,"$1,248.24",USD,
`

describe('parseShareworksReleasesCsv', () => {
  it('parses release rows and derives held plus sell-to-cover transactions', () => {
    const parsed = parseShareworksReleasesCsv(sampleCsv)
    const transactions = deriveReleaseTransactions(parsed.rows)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.ignoredRows).toEqual([
      {
        sourceRowNumber: 4,
        reason: 'Summary totals row',
        preview: '10 | 4 | 6 | $3,160.00',
      },
    ])
    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({
      transactionType: 'ACQUIRE',
      tradeDate: '2025-02-13',
      shares: 6,
      pricePerShareUsd: 316,
      grossAmountUsd: 1896,
    })
    expect(transactions[1]).toMatchObject({
      transactionType: 'SELL_TO_COVER',
      tradeDate: '2025-02-14',
      shares: 4,
      pricePerShareUsd: 312.0903,
      grossAmountUsd: 1248.36,
      feeUsd: 0.12,
    })
  })
})
