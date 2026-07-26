import { describe, expect, it } from 'vitest'

import { deriveReleaseTransactions, parseShareworksReleasesCsv } from './releases'

const sampleCsv = `RSU Releases
Period Start Date,Period End Date,Grant Date,Grant Number,Grant Type,Grant Name,Grant Reason,Release Date,Shares Vested,Shares Sold-To-Cover,Shares Held,Value,,Fair Market Value Per Share,,Sale Date (Sell-To-Cover only),Sale Price Per Share,,Sale Proceeds,,Sell-To-Cover Amount,,Release Reference Number
01-Jan-2025,31-Dec-2025,05-Jan-2025,GRANT-001,Share Units (RSU),Sample Grant Alpha,Ongoing,10-Mar-2025,12,4,8,"$1,200.00",USD,$100.00,USD,11-Mar-2025,$98.5000,USD,"$394.00",USD,"$393.80",USD,RELREF-001
,,,,,,,,12,4,8,"$1,200.00",USD,,,,,,"$394.00",USD,"$393.80",USD,
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
        preview: '12 | 4 | 8 | $1,200.00',
      },
    ])
    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({
      transactionType: 'ACQUIRE',
      tradeDate: '2025-03-10',
      shares: 8,
      pricePerShareUsd: 100,
      grossAmountUsd: 800,
    })
    expect(transactions[1]).toMatchObject({
      transactionType: 'SELL_TO_COVER',
      tradeDate: '2025-03-11',
      shares: 4,
      pricePerShareUsd: 98.5,
      grossAmountUsd: 394,
      feeUsd: 0.2,
    })
  })
})
