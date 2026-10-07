declare module "@typescript-eslint/eslint-plugin";
declare module "eslint-plugin-jsx-a11y";
declare module "eslint-plugin-barrel-files";
declare module "eslint-plugin-use-client";
declare module "eslint-plugin-react-you-might-not-need-an-effect";
declare module "eslint-plugin-slop";
declare module "eslint-plugin-sonarjs";
declare module "@vitest/eslint-plugin";
declare module "eslint-plugin-playwright";
declare module "eslint-plugin-unicorn";
declare module "@stylistic/eslint-plugin";
declare module "eslint-plugin-testing-library";
declare module "eslint-plugin-react-perf";
declare module "eslint-plugin-react-refresh";
declare module "eslint-plugin-react-hooks";
declare module "eslint-plugin-jsdoc";
declare module "picomatch" {
  export default function picomatch(
    patterns: string | string[],
    options?: Record<string, unknown>,
  ): (str: string) => boolean;
}
declare module "eslint-plugin-test-smells" {
  import type { Rule } from "eslint";

  const plugin: {
    rules: Record<string, Rule.RuleModule>;
  };
  export default plugin;
}
