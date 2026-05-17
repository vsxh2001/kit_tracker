import { Component, type ErrorInfo, type ReactNode } from "react";
import { pb } from "../lib/pocketbase";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
    if (!pb.authStore.token) return;
    const changes = JSON.stringify({
      message: error.message,
      stack: error.stack?.slice(0, 2000),
      componentStack: info.componentStack?.slice(0, 2000),
      url: window.location.href,
      ua: navigator.userAgent,
      via: "web",
    });
    pb.collection("audit_log")
      .create({
        collection_name: "frontend",
        record_id: "",
        actor: pb.authStore.model?.id ?? "",
        action: "frontend_error",
        changes,
      }, { requestKey: null })
      .catch(() => {/* never throw from componentDidCatch */});
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="max-w-md space-y-3 text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground font-mono">{this.state.error.message}</p>
            <button
              className="text-sm text-indigo-600 hover:underline"
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
