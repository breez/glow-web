import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { logger, LogCategory } from '@/services/logger';
import { initWasm } from './services/wasmLoader';

// Hide the initial splash screen - exported so App can call it when truly ready
export function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 300);
  }
}

async function init() {
  try {
    logger.info(LogCategory.UI, 'Initializing application');
    // Initialize WASM module
    await initWasm();

    // Render the app - splash stays visible until App signals it's ready
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <App />
    );
    logger.info(LogCategory.UI, 'Application initialized successfully');
    
    // Note: splash is now hidden by App.tsx when initial loading completes
  } catch (error) {
    logger.error(LogCategory.UI, 'Failed to initialize app', {
      error: error instanceof Error ? error.message : String(error),
    });
    hideSplash();
    document.getElementById('root')!.innerHTML = `
      <div style="color: #ef4444; padding: 20px; text-align: center; background: #0a0a0f; min-height: 100vh; display: flex; flex-direction: column; justify-content: center;">
        <h2>Failed to load application</h2>
        <p>There was an error initializing the wallet. Please refresh and try again.</p>
      </div>
    `;
  }
}

init();
