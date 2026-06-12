import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onReset: () => void;
};

type State = {
  error: Error | null;
};

export class PlanTabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Plan preview render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const stack = this.state.error.stack ?? "";
      const copyStack = async () => {
        try {
          await navigator.clipboard.writeText(
            `${this.state.error?.message}\n\n${stack}`
          );
        } catch {
          /* ignore */
        }
      };
      return (
        <div className="plan-error-panel glass-card" role="alert">
          <h4 className="plan-error-title">Preview crashed</h4>
          <p className="plan-error-headline">
            The proposal preview could not be rendered. The data may be invalid or incomplete.
          </p>
          <p className="plan-error-message">{this.state.error.message}</p>
          <div className="plan-error-tech-actions">
            <button
              type="button"
              className="btn btn-tinted"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset();
              }}
            >
              Reset preview
            </button>
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => void copyStack()}>
              Copy stack
            </button>
          </div>
          {stack ? <pre className="plan-error-pre">{stack}</pre> : null}
        </div>
      );
    }
    return this.props.children;
  }
}
