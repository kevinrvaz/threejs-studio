import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ModellingAgent } from './agent.js';
import { terminalConfirm } from './confirmation.js';
import { loadConfig } from './config.js';
import { TrueFoundryResponsesClient } from './responses.js';
import { WebMCPBrowser } from './webmcp.js';

async function main() {
  const config = loadConfig();
  const browser = await WebMCPBrowser.attach(config.cdpUrl, config.studioUrl);
  const agent = new ModellingAgent(config, {
    browser,
    model: new TrueFoundryResponsesClient(config),
    confirm: terminalConfirm,
    write: (message) => console.log(message),
  });
  const readline = createInterface({ input, output });
  try {
    await agent.start();
    console.log('Describe a modelling task. Type /exit to close the agent.');
    while (true) {
      const request = (await readline.question('\nYou: ')).trim();
      if (!request) continue;
      if (request === '/exit' || request === '/quit') break;
      try {
        await agent.respond(request);
      } catch (error) {
        console.error(`Agent error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    readline.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
