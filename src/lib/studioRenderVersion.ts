/** A rendered file is usable only for the exact inputs of the selected version. */
export function currentRenderOutput<T extends { inputSignature?: string }>(
  version: { inputSignature: string } | undefined,
  output: T | undefined,
): T | undefined {
  return version && output?.inputSignature === version.inputSignature ? output : undefined;
}
