export interface CliIo {
  readonly interactive: boolean
  readonly signal?: AbortSignal
  read(prompt: string): Promise<string | null>
  write(message: string): void
  writeError(message: string): void
  delay(milliseconds: number): Promise<void>
}
