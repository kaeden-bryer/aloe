/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" serves every API call from src/api/mock.ts instead of the server. */
  readonly VITE_USE_MOCKS?: string;
  /** Demo maintainer token sent as x-aloe-maintainer (defaults to the server demo token). */
  readonly VITE_ALOE_MAINTAINER_TOKEN?: string;
}
