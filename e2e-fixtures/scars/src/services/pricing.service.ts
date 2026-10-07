export class PricingService {
  calculateTax(amount: number): number {
    return Math.round(amount * 1.2);
  }

  formatPrice(amount: number): string {
    return amount.toFixed(2);
  }
}
