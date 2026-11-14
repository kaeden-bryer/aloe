/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" serves every API call from src/api/mock.ts instead of the server. */
  readonly VITE_USE_MOCKS?: string;
}
