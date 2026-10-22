import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**", // E2E uses a separate Next cache while the developer server is running.
    "out/**",
    "build/**",
    "dist-electron/**",
    ".tmp/**",
    ".pnpm-store/**",
    ".understand-anything/**",
    "learn-claude-code/**",
    "release/**",
    "apps/mobile/android/**/build/**",
    "apps/mobile/android/app/src/main/assets/**",
    "apps/mobile/dist/**",
    "apps/mobile/ios/App/App/public/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
