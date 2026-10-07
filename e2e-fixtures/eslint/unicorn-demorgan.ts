export async function testUnicornAndDeMorgan(
  firstCondition: boolean,
  secondCondition: boolean,
  promiseTask: Promise<number>,
  numberList: number[],
  inputObject: Record<string, string>,
) {
  await Promise.all([await promiseTask]);
  Promise.all([promiseTask]);
  const spreadResult = { ...(inputObject || {}) };

  if (numberList.length > 0 && numberList.some((item) => item > 0)) {
    console.log(spreadResult);
  }

  if (!firstCondition === secondCondition) {
    console.log(firstCondition);
  }

  fetch("/api/endpoint", { method: "GET", body: "invalid-body-for-get" });

  const fallbackValue = firstCondition ? firstCondition : secondCondition;
  const notConjunction = !(firstCondition && secondCondition);
  const notDisjunction = !(firstCondition || secondCondition);

  return Promise.resolve(fallbackValue);
}
