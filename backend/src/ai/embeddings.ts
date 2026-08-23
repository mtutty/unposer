import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config';
import { AppError } from '../types';

// Deliberate exception to CLAUDE.md's provider-agnostic-via-llm.ts principle: that abstraction is
// for chat, and Anthropic has no embeddings API. Regardless of LLM_PROVIDER, embeddings for
// profile_evidence/conversation_evidence (see evidence.service.ts) always go through OpenAI —
// this is a second, independent credential; do not assume LLM_API_KEY covers it when
// LLM_PROVIDER=anthropic (config.embeddings.apiKey falls back to LLM_API_KEY only when the
// configured provider is openai — see config/index.ts).
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536; // must match the vector(1536) column on both evidence tables

function getEmbeddingsClient(): OpenAIEmbeddings {
  const apiKey = config.embeddings.apiKey;
  if (!apiKey) {
    throw new AppError(
      'EMBEDDINGS_NOT_CONFIGURED',
      'No embeddings API key is configured. Set EMBEDDINGS_API_KEY (or LLM_API_KEY when LLM_PROVIDER=openai) in .env.',
      503
    );
  }
  return new OpenAIEmbeddings({ apiKey, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS });
}

export async function embedText(text: string): Promise<number[]> {
  try {
    return await getEmbeddingsClient().embedQuery(text);
  } catch (error: any) {
    // getEmbeddingsClient()'s own EMBEDDINGS_NOT_CONFIGURED (503) is thrown inside this same try
    // block — pass an AppError through as-is rather than re-wrapping it into a generic 502, or
    // that more specific code/status can never reach the caller.
    if (error instanceof AppError) throw error;
    throw new AppError('EMBEDDINGS_ERROR', `Embedding request failed: ${error.message || 'unknown error'}`, 502);
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  try {
    return await getEmbeddingsClient().embedDocuments(texts);
  } catch (error: any) {
    // See embedText above.
    if (error instanceof AppError) throw error;
    throw new AppError('EMBEDDINGS_ERROR', `Embedding request failed: ${error.message || 'unknown error'}`, 502);
  }
}
