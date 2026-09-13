export {}

declare global {
  namespace NodeJS {
    // Optional deployment overrides remain optional in Pick<ProcessEnv, ...> and test fixtures.
    interface ProcessEnv {
      ORCHESTRATOR_PROVIDER?: string
      ORCHESTRATOR_MODEL_ID?: string
    }
  }
}
