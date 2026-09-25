/// <reference types="vite/client" />
import type { FoxmaskApi } from '../../preload/index'

declare global {
  interface Window {
    foxmask: FoxmaskApi
  }
}

export {}
