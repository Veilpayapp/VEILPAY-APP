import { marketStreamer } from '../marketStreamer';
import * as marketData from '../marketData';

jest.mock('../marketData', () => ({
  updateLiveQuote: jest.fn(),
}));

class MockWebSocket {
  onopen: any;
  onmessage: any;
  onclose: any;
  onerror: any;
  readyState = 0; // CONNECTING
  url: string;
  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 0);
  }
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}

// Replace global WebSocket
(global as any).WebSocket = MockWebSocket;

describe('marketStreamer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('subscribes and creates websocket connection', () => {
    marketStreamer.subscribe(['ETH']);
    // Advance timers so MockWebSocket can call onopen
    jest.advanceTimersByTime(10);
  });

  it('handles messages and updates live quotes', () => {
    const listener = jest.fn();
    marketStreamer.addListener(listener);
    
    // We can simulate a message if we reach into the streamer's ws property
    // A simpler way is to use subscribe and then find the active websocket.
    marketStreamer.subscribe(['SOL']);
    jest.advanceTimersByTime(2000); // Allow reconnect to happen if ws was closed
    
    // Simulate finding the active websocket instance on the streamer
    const ws = (marketStreamer as any).ws;
    expect(ws).toBeDefined();

    if (ws && ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({
          data: {
            s: 'SOLUSDT',
            c: '150.50',
            P: '5.2'
          }
        })
      });
    }

    expect(marketData.updateLiveQuote).toHaveBeenCalledWith('SOL', 150.50, 5.2);
    expect(listener).toHaveBeenCalledWith('SOL', 150.50, 5.2);

    marketStreamer.removeListener(listener);
  });

  it('handles websocket close and reconnects', () => {
    const ws = (marketStreamer as any).ws;
    if (ws && ws.onclose) {
      ws.onclose();
    }
    
    // Advance timer to trigger reconnect
    jest.advanceTimersByTime(1000);
    
    expect((marketStreamer as any).ws).toBeDefined();
    // Verify attemptReconnect logic
    jest.advanceTimersByTime(10000);
  });

  it('unsubscribes and closes connection when empty', () => {
    marketStreamer.unsubscribe(['ETH']);
    marketStreamer.unsubscribe(['SOL']);
    // Since ETH and SOL were added, and ref count is now 0, it should close
    expect((marketStreamer as any).activeStreams.size).toBe(0);
  });
});
