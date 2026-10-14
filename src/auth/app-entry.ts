import { z } from 'zod';
import { DaoRefSchema } from '@daclify/core-protocol';
const MethodSchema = z.enum(['telegram', 'email', 'passkey']);
export function appSignInMethod(value: unknown) {
  const parsed = MethodSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function appJoinDestination(
  fragment: string,
  network: { chainId: string; runtime: string } | undefined,
): string | undefined {
  if (!network) return;
  const hints = new URLSearchParams(fragment.replace(/^#/, ''));
  if (
    ['daclify_chain', 'daclify_runtime', 'daclify_dao'].some(
      (key) => hints.getAll(key).length !== 1,
    )
  )
    return;
  const parsed = DaoRefSchema.safeParse({
    chainId: hints.get('daclify_chain'),
    contract: hints.get('daclify_runtime'),
    daoId: hints.get('daclify_dao'),
    interfaceVersion: 1,
  });
  if (
    !parsed.success ||
    parsed.data.chainId !== network.chainId ||
    parsed.data.contract !== network.runtime
  )
    return;
  return `/dao/${parsed.data.daoId}/members`;
}
