export class QuotationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'QuotationError';
  }
}

export function invalidQuote(message: string, details?: unknown): never {
  throw new QuotationError('invalid_quote_request', message, 400, details);
}
