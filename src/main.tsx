import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initWasm } from './services/wasmLoader';

// Hide the initial splash screen
function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 300);
  }
}

async function init() {
  try {
    // Initialize WASM module
    await initWasm();

    // Render the app
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <App />
    );
    
    // Hide splash after React mounts
    hideSplash();
  } catch (error) {
    console.error('Failed to initialize app:', error);
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
