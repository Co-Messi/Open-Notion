import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/editor.css';
import './styles/ui.css';
import './styles/db.css';
import './styles/status.css';
import { App } from './App';
import { installGlobalErrorCapture } from './lib/diagnostics';
import { startPersistence } from './store/store';
import { useSaveState } from './store/saveState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RecoveryScreen } from './components/RecoveryScreen';
import { StatusBanners } from './components/StatusBanners';
import { DialogHost } from './components/ConfirmDialog';

installGlobalErrorCapture();
startPersistence();

/** Unreadable stored data shows the recovery screen instead of the app (nothing is saved). */
function Root() {
  const s = useSaveState();
  if (s.readonlyReason === 'recovery') return <RecoveryScreen />;
  return (
    <>
      <App />
      <StatusBanners />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
    <DialogHost />
  </>,
);
