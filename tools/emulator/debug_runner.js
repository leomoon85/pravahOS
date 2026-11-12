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
            console.log('ACTIVE APP BEFORE:', runner.currentAppId);
            runner.launch('calculator');
            console.log('ACTIVE APP AFTER:', runner.currentAppId);
            const modal = document.querySelector('.app-runner-modal, .calculator-app-container, .stock-app-viewport');
            return {
              currentAppId: runner.currentAppId,
              modalFound: !!modal,
              modalClass: modal ? modal.className : null,
              modalDisplay: modal ? getComputedStyle(modal).display : null,
              modalZIndex: modal ? getComputedStyle(modal).zIndex : null
            };
          })()
        `,
        returnByValue: true
      }
    }));
  };

  ws.onmessage = (msg) => {
    console.log('AppRunner Diagnostic:', msg.data);
    process.exit(0);
  };
}

main().catch(console.error);
