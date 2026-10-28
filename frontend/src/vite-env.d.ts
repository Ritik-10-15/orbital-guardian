/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_READ_ONLY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
