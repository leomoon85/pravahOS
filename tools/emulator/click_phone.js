const ws = new (globalThis.WebSocket)('ws://127.0.0.1:9222/devtools/page/EBA9B12A98DE7BF4B4982A336646BE10');

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (() => {
          const btn = document.getElementById('app-tile-phone');
          if (!btn) return 'BUTTON NOT FOUND';
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return 'CLICK DISPATCHED';
        })()
      `
    }
  }));
};

ws.onmessage = (msg) => {
  console.log('DOM click response:', msg.data);
  process.exit(0);
};
