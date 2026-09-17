export type QueryContextSelection = {
  text: string;
  reduced: boolean;
  selectedChunks: number;
  totalChunks: number;
};

export function queryTerms(question: string): string[];
export function chunkAiContext(text: string, targetChars?: number): string[];
export function selectQueryContext(text: string, question: string, maxChars?: number): QueryContextSelection;
