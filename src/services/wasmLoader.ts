import initBreezSDK from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';

// Flag to ensure we only initialize once
let initialized = false;

// Function to initialize the WASM module
export const initWasm = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  try {
    // Initialize the WASM module
    logger.info(LogCategory.SDK, 'Initializing WASM module');
    await initBreezSDK();
    logger.info(LogCategory.SDK, 'WASM module initialized successfully');
    initialized = true;
  } catch (error) {
    logger.error(LogCategory.SDK, 'Failed to initialize WASM module', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

// Check if WASM has been initialized
export const isWasmInitialized = (): boolean => {
  return initialized;
};
