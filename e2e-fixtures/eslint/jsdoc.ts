
/**
 * Valid description.
 * @typedef {object} SomeType
 * @property {string} foo.bar - invalid property without foo defined
 */
export const typedObject = { foo: 1 };

/**
 * Description.
 * @param wrongParamName Parameter description
 * @invalidTagName
 */
export function badTags(actualParam: string) {
  return actualParam;
}

/**
  * Misaligned asterisk
 */
export function misaligned() {
  return 1;
}

/**
 * Missing asterisk prefix on next line
 line without asterisk
 */
export function missingAsterisk() {
  return 1;
}

/*
 * Bad block comment with tag
 * @param test - test param
 */
export function badBlock(test: string) {
  return test;
}
