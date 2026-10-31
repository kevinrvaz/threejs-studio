interface WebMCPNativeTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: object;
}

interface WebMCPNativeResult {
  content?: { text?: string }[];
  isError?: boolean;
}

interface ModelContext {
  getTools(): Promise<WebMCPNativeTool[]>;
  executeTool(tool: WebMCPNativeTool, input: object): Promise<string | WebMCPNativeResult>;
}

interface Document {
  modelContext: ModelContext;
}
