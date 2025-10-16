export class HttpError extends Error {
  public readonly status: number;
  public readonly causeCode: string;

  constructor(status: number, causeCode: string, message?: string) {
    super(message ?? causeCode);
    this.name = 'HttpError';
    this.status = status;
    this.causeCode = causeCode;
  }
}
