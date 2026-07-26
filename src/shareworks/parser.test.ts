import { describe, expect, it } from 'vitest'

import { parseShareworksCsv } from './parser'
import { deriveLongShareSaleTransactions } from './transform'

const sampleCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-001,RELREF-001,GRANT-001,Sample Grant Alpha,1,Long Shares,20-Jun-2025,10-Mar-2025,NO,$100.00,USD,$500.00,USD,5,$550.00,USD,$110.0000,USD,$0.00,USD,$0.20,USD
01-Jan-2025,31-Dec-2025,SELLREF-002,RELREF-002,GRANT-002,Sample Grant Beta,1,Long Shares,01-Jul-2025,15-Apr-2025,NO,$120.00,USD,$480.00,USD,4,$520.00,USD,$130.0000,USD,$0.00,USD,$0.25,USD
,,,,,,,,,,,,,,,9,"$1,070.00",USD,,,$0.00,USD,$0.45,USD
`

describe('parseShareworksCsv', () => {
  it('parses data rows and ignores the totals row', () => {
    const parsed = parseShareworksCsv(sampleCsv)

    expect(parsed.reportName).toBe('Sales - Long Shares')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.ignoredRowCount).toBe(1)
    expect(parsed.ignoredRows).toEqual([
      {
        sourceRowNumber: 5,
        reason: 'Summary totals row',
        preview: '9 | $1,070.00 | USD | $0.00',
      },
    ])
    expect(parsed.rows[0]).toMatchObject({
      withdrawalReferenceNumber: 'SELLREF-001',
      grantName: 'Sample Grant Alpha',
      saleDate: '2025-06-20',
      originalAcquisitionDate: '2025-03-10',
      sharesSold: 5,
      originalCostBasisUsd: 500,
      saleProceedsUsd: 550,
      supplementalTransactionFeeUsd: 0.2,
    })
  })

  it('derives sell transactions from each sales row', () => {
    const parsed = parseShareworksCsv(sampleCsv)
    const transactions = deriveLongShareSaleTransactions(parsed.rows)

    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({
      transactionType: 'SELL',
      tradeDate: '2025-06-20',
      shares: 5,
      pricePerShareUsd: 110,
      grossAmountUsd: 550,
      feeUsd: 0.2,
    })
    expect(transactions[1]).toMatchObject({
      transactionType: 'SELL',
      tradeDate: '2025-07-01',
      shares: 4,
      grossAmountUsd: 520,
      feeUsd: 0.25,
    })
  })

  it('marks incomplete non-total rows as ignored', () => {
    const csv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-001,RELREF-001,GRANT-001,Sample Grant Alpha,1,Long Shares,20-Jun-2025,10-Mar-2025,NO,$100.00,USD,$500.00,USD,5,$550.00,USD,$110.0000,USD,$0.00,USD,$0.20,USD
01-Jan-2025,31-Dec-2025,SELLREF-003,RELREF-003,GRANT-003,Sample Grant Gamma,1,Long Shares,,10-Mar-2025,NO,$100.00,USD,$500.00,USD,,$550.00,USD,$110.0000,USD,$0.00,USD,$0.20,USD
`

    const parsed = parseShareworksCsv(csv)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.ignoredRows).toEqual([
      {
        sourceRowNumber: 4,
        reason: 'Incomplete or unsupported row',
        preview: '01-Jan-2025 | 31-Dec-2025 | SELLREF-003 | RELREF-003',
      },
    ])
  })

  it('throws when the header columns do not match the Shareworks sales format', () => {
    const invalidHeaderCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Trade Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
01-Jan-2025,31-Dec-2025,SELLREF-001,RELREF-001,GRANT-001,Sample Grant Alpha,1,Long Shares,20-Jun-2025,10-Mar-2025,NO,$100.00,USD,$500.00,USD,5,$550.00,USD,$110.0000,USD,$0.00,USD,$0.20,USD
`

    expect(() => parseShareworksCsv(invalidHeaderCsv)).toThrow(
      'The uploaded file does not match the expected Shareworks sales format.',
    )
  })

  it('throws when required Shareworks header rows are missing', () => {
    expect(() => parseShareworksCsv('Sales - Long Shares,\nHeader,\n')).toThrow(
      'The uploaded CSV is missing the required Shareworks header rows.',
    )
  })

  it('throws when the Shareworks header row is too short', () => {
    const shortHeaderCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number
01-Jan-2025,31-Dec-2025,SELLREF-001
`

    expect(() => parseShareworksCsv(shortHeaderCsv)).toThrow(
      'The uploaded CSV does not contain the expected Shareworks columns.',
    )
  })

  it('throws when no valid sales rows remain after filtering', () => {
    const noSalesCsv = `Sales - Long Shares
Period Start Date,Period End Date,Withdrawal Reference Number,Originating Release Reference Number,Employee Grant Number,Grant Name,Lot Number,Sale Type,Sale Date,Original Acquisition Date,Sold Within 30 Days of Vest,Original Cost Basis Per Share,,Original Cost Basis,,Shares Sold,Sale Proceeds,,Sale Price Per Share,,Brokerage Commission,,Supplemental Transaction Fee,
,,,,,,,,,,,,,,,9,"$1,070.00",USD,,,$0.00,USD,$0.45,USD
`

    expect(() => parseShareworksCsv(noSalesCsv)).toThrow(
      'No Shareworks sale rows were found in the uploaded CSV.',
    )
  })
})
