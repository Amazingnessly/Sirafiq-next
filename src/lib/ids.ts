export function newId(): string {
  return crypto.randomUUID();
}

export function isoNow(): string {
  return new Date().toISOString();
}
