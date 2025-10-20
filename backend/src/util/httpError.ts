export class HttpError extends Error {
  public readonly status: number;
  public readonly causeCode: string;
  public readonly headers?: Record<string, string>;

  constructor(status: number, causeCode: string, message?: string, headers?: Record<string, string>) {
    super(message ?? causeCode);
    this.name = 'HttpError';
    this.status = status;
    this.causeCode = causeCode;
    this.headers = headers;
  }
}
