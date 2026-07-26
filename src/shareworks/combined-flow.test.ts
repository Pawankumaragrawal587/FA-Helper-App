import { describe, expect, it } from 'vitest'

import { buildFifoReport } from './fifo'
import { parseShareworksCsv } from './parser'
import { deriveReleaseTransactions, parseShareworksReleasesCsv } from './releases'
import { deriveLongShareSaleTransactions } from './transform'

const salesCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-001,RELREF-001,GRANT-001,Example Grant A,1,Long Shares,18-Feb-2025,13-Feb-2025,YES,$316.00,USD,$948.00,USD,3,$942.00,USD,$314.0000,USD,$0.00,USD,$0.06,USD
01-Jan-2025,31-Dec-2025,SELLREF-002,RELREF-002,GRANT-002,Example Grant B,1,Long Shares,04-Mar-2025,18-Feb-2025,YES,$315.44,USD,"$1,892.64",USD,6,"$1,605.00",USD,$267.5000,USD,$0.00,USD,$0.13,USD
`

const releasesCsv = `RSU Releases
Period Start Date,Period End Date,Grant Date,Grant Number,Grant Type,Grant Name,Grant Reason,Release Date,Shares Vested,Shares Sold-To-Cover,Shares Held,Value,,Fair Market Value Per Share,,Sale Date (Sell-To-Cover only),Sale Price Per Share,,Sale Proceeds,,Sell-To-Cover Amount,,Release Reference Number
01-Jan-2025,31-Dec-2025,20-Sep-2024,GRANT-001,Share Units (RSU),Example Grant A,Ongoing,13-Feb-2025,10,4,6,"$3,160.00",USD,$316.00,USD,14-Feb-2025,$312.0903,USD,"$1,248.36",USD,"$1,248.24",USD,RELREF-001
01-Jan-2025,31-Dec-2025,21-Sep-2024,GRANT-002,Share Units (RSU),Example Grant B,Ongoing,18-Feb-2025,10,2,8,"$3,154.40",USD,$315.44,USD,19-Feb-2025,$300.0000,USD,"$600.00",USD,"$599.90",USD,RELREF-002
`

describe('Shareworks combined flow', () => {
  it('uses releases for held lots and long-share sales for FIFO matching', () => {
    const parsedSales = parseShareworksCsv(salesCsv)
    const parsedReleases = parseShareworksReleasesCsv(releasesCsv)
    const releaseTransactions = deriveReleaseTransactions(parsedReleases.rows)
    const longShareSales = deriveLongShareSaleTransactions(parsedSales.rows)
    const fifoReport = buildFifoReport([...releaseTransactions, ...longShareSales])

    expect(parsedSales.rows).toHaveLength(2)
    expect(parsedReleases.rows).toHaveLength(2)
    expect(releaseTransactions.filter((row) => row.transactionType === 'ACQUIRE')).toHaveLength(2)
    expect(releaseTransactions.filter((row) => row.transactionType === 'SELL_TO_COVER')).toHaveLength(2)
    expect(longShareSales).toHaveLength(2)
    expect(fifoReport.matchedLots).toHaveLength(3)
    expect(fifoReport.unmatchedSellShares).toBe(0)
    expect(
      fifoReport.openHoldings.reduce((total, holding) => total + holding.sharesRemaining, 0),
    ).toBe(5)
    expect(fifoReport.openHoldings.map((holding) => holding.sharesRemaining)).toEqual([5])
  })
})
