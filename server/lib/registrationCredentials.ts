const PASSWORD_PERSISTENCE_DISABLED =
  'Registration passwords are authentication secrets and must not be persisted outside the password hash store.';

/**
 * @deprecated Customer passwords must only be sent to the authentication provider.
 * This fail-closed compatibility export prevents a future caller from silently
 * reintroducing recoverable password storage.
 */
export function encryptRegistrationPassword(_value: string): never {
  throw new Error(PASSWORD_PERSISTENCE_DISABLED);
}

/**
 * @deprecated Historical registration credentials are deliberately ignored.
 * They may be cleared by a migration, but must never be recovered or displayed.
 */
export function decryptRegistrationPassword(_value?: string): string {
  return '';
}
