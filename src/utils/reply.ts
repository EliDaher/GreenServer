export class RejectedWrite extends Error {
  constructor(readonly status: number, readonly body: object) {
    super("Write rejected");
  }
}

export function reply(status: number, body: object) {
  if (status >= 400) throw new RejectedWrite(status, body);
  return { status, body };
}
