import { updateLiveQuote } from './marketData';

type Listener = (symbol: string, price: number, change24h: number | null) => void;

const BINANCE_SYMBOLS: Record<string, string> = {
  ETH: 'ETHUSDT',
  MATIC: 'MATICUSDT',
  SOL: 'SOLUSDT',
  USDC: 'USDCUSDT',
  DAI: 'DAIUSDT',
  BNB: 'BNBUSDT',
  AVAX: 'AVAXUSDT',
  TRX: 'TRXUSDT',
  XLM: 'XLMUSDT',
};

// Reverse map for quick lookup from Binance stream symbol to VeilPay symbol
const STREAM_TO_SYMBOL: Record<string, string> = Object.entries(BINANCE_SYMBOLS).reduce(
  (acc, [internal, binance]) => {
    acc[binance.toLowerCase()] = internal;
    return acc;
  },
  {} as Record<string, string>
);

class MarketStreamer {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private activeStreams = new Set<string>();
  
  // Ref count: how many screens are asking for a specific VeilPay symbol
  private refCounts: Record<string, number> = {};
  
  private listeners: Set<Listener> = new Set();
  private reconnectTimeoutId: NodeJS.Timeout | null = null;

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    if (this.activeStreams.size === 0) {
      return;
    }

    const streams = Array.from(this.activeStreams).map(s => `${s}@ticker`).join('/');
    const url = `wss://data-stream.binance.vision:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.data && data.data.s && data.data.c) {
          const binanceSymbol = data.data.s.toLowerCase();
          const internalSymbol = STREAM_TO_SYMBOL[binanceSymbol];
          
          if (internalSymbol) {
            const price = parseFloat(data.data.c);
            const change24h = parseFloat(data.data.P);
            
            // Update the central memory cache
            updateLiveQuote(internalSymbol, price, change24h);
            
            // Notify active hooks
            this.listeners.forEach(listener => listener(internalSymbol, price, change24h));
          }
        }
      } catch (err) {}
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      // close event will fire next and handle reconnect
    };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || this.activeStreams.size === 0) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    this.reconnectTimeoutId = setTimeout(() => this.connect(), delay);
  }

  private rebuildConnection() {
    if (this.ws) {
      this.ws.close(); // Will trigger reconnect with new streams
    } else {
      this.connect();
    }
  }

  public subscribe(symbols: readonly string[]) {
    let changed = false;
    
    symbols.forEach(symbol => {
      const normalized = symbol.trim().toUpperCase();
      const binanceSym = BINANCE_SYMBOLS[normalized];
      
      if (binanceSym) {
        this.refCounts[normalized] = (this.refCounts[normalized] || 0) + 1;
        if (this.refCounts[normalized] === 1) {
          this.activeStreams.add(binanceSym.toLowerCase());
          changed = true;
        }
      }
    });

    if (changed) {
      this.rebuildConnection();
    }
  }

  public unsubscribe(symbols: readonly string[]) {
    let changed = false;
    
    symbols.forEach(symbol => {
      const normalized = symbol.trim().toUpperCase();
      const binanceSym = BINANCE_SYMBOLS[normalized];
      
      if (binanceSym && this.refCounts[normalized] > 0) {
        this.refCounts[normalized]--;
        if (this.refCounts[normalized] === 0) {
          this.activeStreams.delete(binanceSym.toLowerCase());
          changed = true;
        }
      }
    });

    if (changed) {
      if (this.activeStreams.size === 0 && this.ws) {
        this.ws.close();
      } else if (this.activeStreams.size > 0) {
        this.rebuildConnection();
      }
    }
  }

  public addListener(listener: Listener) {
    this.listeners.add(listener);
  }

  public removeListener(listener: Listener) {
    this.listeners.delete(listener);
  }
}

export const marketStreamer = new MarketStreamer();
