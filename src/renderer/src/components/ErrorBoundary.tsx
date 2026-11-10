import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <div className="max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg">
          <h1 className="text-base font-semibold">界面出现错误 / Something went wrong</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            界面渲染失败，但你本地的数据没有丢失。可以重新加载应用继续。
            <br />
            The interface failed to render. Your local data is safe. Reload the app to continue.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[10px] text-muted-foreground">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            重新加载 / Reload
          </button>
        </div>
      </div>
    )
  }
}
