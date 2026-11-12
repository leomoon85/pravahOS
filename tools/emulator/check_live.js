import http from 'http';

async function main() {
  const targets = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page = targets.find(t => t.type === 'page');
  if (!page) {
    console.error('No page target found');
    process.exit(1);
  }

  const ws = new (globalThis.WebSocket)(page.webSocketDebuggerUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (() => {
            localStorage.setItem('pravah_tour_completed', 'true');
            document.querySelectorAll('.tour-spotlight-layer, .tour-tooltip-container, .tour-backdrop').forEach(el => el.remove());
            return {
              hasGetAppRunner: typeof window.getAppRunner,
              hasCalculator: !!document.getElementById('app-tile-calculator')
            };
          })()
        `,
        returnByValue: true
      }
    }));
  };

  ws.onmessage = (msg) => {
    console.log('AppRunner Status:', msg.data);
    process.exit(0);
  };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
