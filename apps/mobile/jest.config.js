export default {
  preset: "jest-expo",
  // Serial route rendering needs scheduling headroom on the shared memory-constrained runner.
  testTimeout: 30_000,
  transform: { "^.+\\.mjs$": "babel-jest" },
  setupFilesAfterEnv: ["<rootDir>/src/testing/setup.ts"],
  testMatch: ["**/src/**/*.test.[jt]s?(x)"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transformIgnorePatterns: [
    "node_modules/(?!((?:\\.pnpm/)?(?:react-native|@react-native|expo|@expo|@aqarak|@noble|@rn-primitives|nativewind|react-native-css-interop|react|test-renderer|standard-navigation|use-intl|intl-messageformat|@formatjs|@expo-google-fonts|lucide-react-native|@tanstack)))",
  ],
};
