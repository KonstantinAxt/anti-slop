/**
 * Tax computation service providing deterministic unrounded financial operations.
 */
export class CleanPricingService {
  /**
   * Computes the raw tax value for a given line amount.
   *
   * @param amount Subtotal amount before tax.
   * @param taxRate Decimal tax rate.
   * @returns Unrounded raw tax amount.
   */
  public computeTax(amount: number, taxRate: number): number {
    const rawTax = amount * taxRate;

    return rawTax;
  }
}
