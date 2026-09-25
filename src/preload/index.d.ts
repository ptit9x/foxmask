import type { FoxmaskApi } from './index'

declare global {
  interface Window {
    foxmask: FoxmaskApi
  }
}

export {}
