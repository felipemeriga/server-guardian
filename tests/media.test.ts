import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/media.js';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const result = chunkText('hello world', 4000);
    expect(result).toEqual(['hello world']);
  });

  it('splits at paragraph boundary', () => {
    const para1 = 'A'.repeat(3000);
    const para2 = 'B'.repeat(3000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text, 4000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at newline if no paragraph boundary', () => {
    const line1 = 'A'.repeat(3000);
    const line2 = 'B'.repeat(3000);
    const text = `${line1}\n${line2}`;
    const chunks = chunkText(text, 4000);
    expect(chunks.length).toBe(2);
  });

  it('hard-splits if a single line exceeds limit', () => {
    const longLine = 'A'.repeat(8000);
    const chunks = chunkText(longLine, 4000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(4000);
    expect(chunks[1].length).toBe(4000);
  });
});
