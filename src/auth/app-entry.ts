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

export function appInvitation(fragment: string) {
 const hints=new URLSearchParams(fragment.replace(/^#/,''));
 if(!hints.has('daclify_invitation')&&!hints.has('daclify_token'))return;
 const parsed=z.object({invitationId:z.string().regex(/^[1-9][0-9]{0,19}$/).refine(value=>BigInt(value)<=18446744073709551615n),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).safeParse({invitationId:hints.get('daclify_invitation'),token:hints.get('daclify_token')});
 if(!parsed.success||hints.getAll('daclify_invitation').length!==1||hints.getAll('daclify_token').length!==1)throw new Error('APP_INVITE_DOMAIN');
 return parsed.data;
}
