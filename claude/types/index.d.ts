export type Call = {
  id: string
  tool: string
  summary: string
  isDone: boolean
  isErrored: boolean
  output: string
}

declare module 'claude-code' {
  interface PluginState {
    hush: {
      calls: Shaped<Call[]>
      openId: string
      showInChat: boolean
      isMinimized: boolean
      isClosedForNarrow: boolean
    }
  }
}
