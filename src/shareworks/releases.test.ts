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

  it('marks incomplete release rows as ignored', () => {
    const csv = `RSU Releases
Period Start Date,Period End Date,Grant Date,Grant Number,Grant Type,Grant Name,Grant Reason,Release Date,Shares Vested,Shares Sold-To-Cover,Shares Held,Value,,Fair Market Value Per Share,,Sale Date (Sell-To-Cover only),Sale Price Per Share,,Sale Proceeds,,Sell-To-Cover Amount,,Release Reference Number
01-Jan-2025,31-Dec-2025,05-Jan-2025,GRANT-001,Share Units (RSU),Sample Grant Alpha,Ongoing,10-Mar-2025,12,4,8,"$1,200.00",USD,$100.00,USD,11-Mar-2025,$98.5000,USD,"$394.00",USD,"$393.80",USD,RELREF-001
01-Jan-2025,31-Dec-2025,05-Feb-2025,GRANT-002,Share Units (RSU),Sample Grant Beta,Ongoing,,,4,8,"$1,200.00",USD,$100.00,USD,11-Mar-2025,$98.5000,USD,"$394.00",USD,"$393.80",USD,RELREF-002
`

    const parsed = parseShareworksReleasesCsv(csv)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.ignoredRows).toEqual([
      {
        sourceRowNumber: 4,
        reason: 'Incomplete or unsupported row',
        preview: '01-Jan-2025 | 31-Dec-2025 | 05-Feb-2025 | GRANT-002',
      },
    ])
  })

  it('emits only the applicable derived transactions for each release row', () => {
    const transactions = deriveReleaseTransactions([
      {
        broker: 'shareworks',
        stockSymbol: 'TEAM',
        sourceRowNumber: 1,
        periodStartDate: '2025-01-01',
        periodEndDate: '2025-12-31',
        grantDate: '2025-01-05',
        grantNumber: 'GRANT-001',
        grantType: 'Share Units (RSU)',
        grantName: 'Held Only',
        grantReason: 'Ongoing',
        releaseDate: '2025-03-10',
        sharesVested: 8,
        sharesSoldToCover: 0,
        sharesHeld: 8,
        valueUsd: 800,
        fairMarketValuePerShareUsd: 100,
        sellToCoverSaleDate: '2025-03-11',
        sellToCoverSalePricePerShareUsd: 98,
        sellToCoverSaleProceedsUsd: 0,
        sellToCoverAmountUsd: 0,
        releaseReferenceNumber: 'RELREF-001',
      },
      {
        broker: 'shareworks',
        stockSymbol: 'TEAM',
        sourceRowNumber: 2,
        periodStartDate: '2025-01-01',
        periodEndDate: '2025-12-31',
        grantDate: '2025-02-05',
        grantNumber: 'GRANT-002',
        grantType: 'Share Units (RSU)',
        grantName: 'Cover Only',
        grantReason: 'Ongoing',
        releaseDate: '2025-04-10',
        sharesVested: 3,
        sharesSoldToCover: 3,
        sharesHeld: 0,
        valueUsd: 300,
        fairMarketValuePerShareUsd: 100,
        sellToCoverSaleDate: '2025-04-11',
        sellToCoverSalePricePerShareUsd: 99,
        sellToCoverSaleProceedsUsd: 297,
        sellToCoverAmountUsd: 296.5,
        releaseReferenceNumber: 'RELREF-002',
      },
    ])

    expect(transactions).toEqual([
      expect.objectContaining({
        id: 'RELREF-001-1-held',
        transactionType: 'ACQUIRE',
        shares: 8,
      }),
      expect.objectContaining({
        id: 'RELREF-002-2-cover',
        transactionType: 'SELL_TO_COVER',
        shares: 3,
        feeUsd: 0.5,
      }),
    ])
  })

  it('throws when required Shareworks release header rows are missing', () => {
    expect(() => parseShareworksReleasesCsv('RSU Releases,\nHeader,\n')).toThrow(
      'The uploaded CSV is missing the required Shareworks header rows.',
    )
  })

  it('throws when the Shareworks release header row is too short', () => {
    const shortHeaderCsv = `RSU Releases
Period Start Date,Period End Date,Grant Date
01-Jan-2025,31-Dec-2025,05-Jan-2025
`

    expect(() => parseShareworksReleasesCsv(shortHeaderCsv)).toThrow(
      'The uploaded CSV does not contain the expected Shareworks columns.',
    )
  })

  it('throws when no valid release rows remain after filtering', () => {
    const noReleasesCsv = `RSU Releases
Period Start Date,Period End Date,Grant Date,Grant Number,Grant Type,Grant Name,Grant Reason,Release Date,Shares Vested,Shares Sold-To-Cover,Shares Held,Value,,Fair Market Value Per Share,,Sale Date (Sell-To-Cover only),Sale Price Per Share,,Sale Proceeds,,Sell-To-Cover Amount,,Release Reference Number
,,,,,,,,12,4,8,"$1,200.00",USD,,,,,,"$394.00",USD,"$393.80",USD,
`

    expect(() => parseShareworksReleasesCsv(noReleasesCsv)).toThrow(
      'No Shareworks release rows were found in the uploaded CSV.',
    )
  })
})
