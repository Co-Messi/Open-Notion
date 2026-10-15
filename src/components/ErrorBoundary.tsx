import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordError } from '../lib/diagnostics';
import { setUi } from '../store/store';
import { downloadRawData } from './workspaceFlows';

/**
 * Root error boundary. A render crash shows a recovery card instead of a white page; the
 * workspace stays saved, the raw data can be downloaded, and Go Home leaves the page that
 * crashed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = (info.componentStack || '').trim().split('\n')[0]?.trim() || '';
    recordError('render', `${error.name}: ${error.message}${where ? ` (${where})` : ''}`);
  }

  private goHome = () => {
    try {
      setUi({ route: { name: 'home' }, selectedBlocks: [], peekRowId: null, settingsOpen: false, searchOpen: false });
      if (location.hash !== '#/home') location.hash = '#/home';
    } catch {
      /* best effort */
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="recovery-screen" role="alert">
        <div className="recovery-card">
          <h1>Something went wrong</h1>
          <p>This view crashed. Your workspace is still saved in this browser, and the error was noted in Settings, Storage.</p>
          <div className="recovery-actions">
            <button className="btn primary" onClick={this.goHome}>
              Go Home
            </button>
            <button className="btn secondary" onClick={downloadRawData}>
              Download raw data
            </button>
            <button className="btn secondary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
          <p className="recovery-detail">{this.state.error.name}: {this.state.error.message}</p>
        </div>
      </div>
    );
  }
}
