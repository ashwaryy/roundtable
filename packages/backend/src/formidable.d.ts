declare module 'formidable' {
  import type { IncomingMessage } from 'node:http'

  export interface File {
    filepath: string
    originalFilename: string | null
    mimetype: string | null
    size: number
  }

  export interface IncomingForm {
    parse(
      req: IncomingMessage,
      callback: (
        err: Error | null,
        fields: Record<string, unknown>,
        files: Record<string, File | File[]>,
      ) => void,
    ): void
  }

  export default function formidable(options?: {
    multiples?: boolean
    maxFileSize?: number
  }): IncomingForm
}
