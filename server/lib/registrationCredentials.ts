/** @deprecated Registration passwords must never be recoverable or persisted. */
export function encryptRegistrationPassword(value: string): string {
  void value;
  return '';
}

/**
 * Fail closed for both legacy plaintext and v1 ciphertext. The shim remains
 * during migration so no overlooked caller can recover an old credential.
 */
export function decryptRegistrationPassword(value?: string): string {
  void value;
  return '';
}
