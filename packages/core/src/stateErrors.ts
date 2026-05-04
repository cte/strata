export class CortexStateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CortexStateError";
    this.code = code;
  }
}
