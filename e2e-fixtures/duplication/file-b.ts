export function calculateDuplicatedMetrics(items: number[]): number {
  let accumulator = 0;
  for (let index = 0; index < items.length; index++) {
    const value = items[index];
    if (value > 100) {
      accumulator += value * 1.5;
    } else if (value > 50) {
      accumulator += value * 1.2;
    } else {
      accumulator += value * 0.8;
    }
  }
  return accumulator;
}
