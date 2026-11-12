const ws = new (globalThis.WebSocket)('ws://127.0.0.1:9222/devtools/page/EBA9B12A98DE7BF4B4982A336646BE10');

ws.onopen = () => {
  console.log('Connected to WebView DevTools!');
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        localStorage.setItem('pravah_tour_completed', 'true');
        document.querySelectorAll('.tour-spotlight-layer, .tour-tooltip-container, .tour-backdrop').forEach(el => el.remove());
        console.log('Tour removed successfully!');
        location.reload();
      `
    }
  }));
};

ws.onmessage = (msg) => {
  console.log('DevTools response:', msg.data);
  process.exit(0);
};

setTimeout(() => {
  console.log('Timeout waiting for DevTools');
  process.exit(0);
}, 3000);
