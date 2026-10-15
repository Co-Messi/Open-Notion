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

installGlobalErrorCapture();
startPersistence();

createRoot(document.getElementById('root')!).render(<App />);
