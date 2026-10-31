import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface Confirm {
  (message: string): Promise<boolean>;
}

export const terminalConfirm: Confirm = async (message) => {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    readline.close();
  }
};

export function isDeleteRequest(toolName: string, args: Record<string, unknown>) {
  return toolName === 'studio_organize_objects' && args.action === 'delete';
}
