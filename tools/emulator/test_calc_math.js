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
  const ws = new (globalThis.WebSocket)(page.webSocketDebuggerUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (() => {
            const runner = window.getAppRunner();
            const calc = runner.currentApp;
            if (!calc) return 'CALC APP NOT FOUND';
            calc.input('7');
            calc.input('×');
            calc.input('8');
            const evalResult = calc.calculate();
            return {
              expression: calc.expression,
              result: calc.result,
              evalResult: evalResult,
              displayExpr: document.getElementById('calc-display-expr')?.textContent?.trim()
            };
          })()
        `,
        returnByValue: true
      }
    }));
  };

  ws.onmessage = (msg) => {
    console.log('Calculation result:', msg.data);
    process.exit(0);
  };
}

main().catch(console.error);
