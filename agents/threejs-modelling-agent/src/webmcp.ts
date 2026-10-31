import { chromium, type Browser, type Page } from 'playwright-core';

export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ToolExecution {
  raw: unknown;
  data: unknown;
  isError: boolean;
}

function comparableUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  return `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}`;
}

export class WebMCPBrowser {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  static async attach(cdpUrl: string, studioUrl: string) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const target = comparableUrl(studioUrl);
    const matches = browser.contexts().flatMap((context) => context.pages()).filter((page) => {
      try {
        return comparableUrl(page.url()) === target;
      } catch {
        return false;
      }
    });
    if (matches.length === 0) {
      await browser.close();
      throw new Error(`No Studio tab matched STUDIO_URL (${studioUrl}).`);
    }
    if (matches.length > 1) {
      await browser.close();
      throw new Error(`More than one Studio tab matched STUDIO_URL (${studioUrl}). Close duplicates first.`);
    }
    const page = matches[0]!;
    const supported = await page.evaluate(() => Boolean(document.modelContext));
    if (!supported) {
      await browser.close();
      throw new Error('The selected tab has no WebMCP modelContext. Start Chrome with WebMCP enabled.');
    }
    return new WebMCPBrowser(browser, page);
  }

  async getTools(): Promise<WebMCPTool[]> {
    return this.page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        annotations: tool.annotations as Record<string, unknown> | undefined,
      }));
    });
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolExecution> {
    const raw = await this.page.evaluate(
      async ({ name, input }) => {
        const tools = await document.modelContext.getTools();
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`WebMCP tool no longer exists: ${name}`);
        return document.modelContext.executeTool(tool, input);
      },
      { name, input },
    );
    const outer = typeof raw === 'string' ? (JSON.parse(raw) as { content?: { text?: string }[]; isError?: boolean }) : raw;
    const text = outer && typeof outer === 'object' && 'content' in outer ? outer.content?.[0]?.text : undefined;
    let data: unknown = outer;
    if (typeof text === 'string') {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { raw: outer, data, isError: Boolean(outer && typeof outer === 'object' && outer.isError) };
  }

  async close() {
    await this.browser.close();
  }
}
