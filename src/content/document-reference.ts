import { BallotContentSchema } from '@daclify/modules';
import { IdSchema } from '@daclify/core-protocol';

export function documentReferenceLocation(input: {
  daoId: string;
  documentId: string;
  version: number;
  commitment?: string | undefined;
  returnTo?: string | undefined;
}) {
  const dao = IdSchema.safeParse(input.daoId),
    reference = BallotContentSchema.shape.document.unwrap().safeParse({
      documentId: input.documentId,
      version: input.version,
      commitment: input.commitment,
    });
  if (!dao.success || !reference.success) return;
  const returnTo =
    input.returnTo?.startsWith(`/dao/${dao.data}/`) &&
    /^\/dao\/[0-9]+\/[a-z-]+$/.test(input.returnTo)
      ? input.returnTo
      : undefined;
  return {
    path: `/dao/${dao.data}/documents`,
    query: {
      document: reference.data.documentId,
      version: String(reference.data.version),
      commitment: reference.data.commitment,
      ...(returnTo ? { returnTo } : {}),
    },
  };
}

export function worksDocumentHint(query: Readonly<Record<string, unknown>>) {
  if (
    typeof query.document !== 'string' ||
    typeof query.version !== 'string' ||
    !/^[1-9][0-9]*$/.test(query.version) ||
    typeof query.commitment !== 'string'
  )
    return;
  const reference = BallotContentSchema.shape.document
    .unwrap()
    .safeParse({
      documentId: query.document,
      version: Number(query.version),
      commitment: query.commitment,
    });
  return reference.success ? reference.data : undefined;
}
