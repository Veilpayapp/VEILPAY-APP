import { startChainIndexer, stopChainIndexer } from '../jobs/chainIndexer';
import { startInvoiceExpiryWorker, stopInvoiceExpiryWorker } from '../lib/invoiceExpiry';
import { startRetentionPurge, stopRetentionPurge } from '../jobs/retentionPurge';
// Round 5: onramp provider status-polling fallback. The start/stop functions
// no-op unless ONRAMP_STATUS_POLLING_ENABLED=true (config-gated, default OFF).
import { startOnrampStatusPoller, stopOnrampStatusPoller } from './onrampOrderStatus';

export interface BackgroundTask {
  name: string;
  start: () => void;
  stop: () => void;
}

const tasks: BackgroundTask[] = [
  {
    name: 'chainIndexer',
    start: startChainIndexer,
    stop: stopChainIndexer,
  },
  {
    name: 'invoiceExpiry',
    start: startInvoiceExpiryWorker,
    stop: stopInvoiceExpiryWorker,
  },
  {
    name: 'retentionPurge',
    start: startRetentionPurge,
    stop: stopRetentionPurge,
  },
  {
    name: 'onrampStatusPoller',
    start: startOnrampStatusPoller,
    stop: stopOnrampStatusPoller,
  },
];

export function startAllBackgroundWorkers(): void {
  console.log('[BackgroundWorker] Starting all workers...');
  tasks.forEach(task => {
    try {
      task.start();
    } catch (error) {
      console.error(`[BackgroundWorker] Failed to start ${task.name}:`, error);
    }
  });
}

export function stopAllBackgroundWorkers(): void {
  console.log('[BackgroundWorker] Stopping all workers...');
  tasks.forEach(task => {
    try {
      task.stop();
    } catch (error) {
      console.error(`[BackgroundWorker] Failed to stop ${task.name}:`, error);
    }
  });
}
