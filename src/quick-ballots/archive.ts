import { z } from 'zod';
import { QuickBallotResultInputSchema, QuickBallotArchiveSchema } from '@daclify/modules';
import { QuickBallotTableSchemas } from '@daclify/modules/quick-ballots';
import {
  verifyAnchoredArchive,
  verifyArchiveChunkDescriptor,
  decodeReleasedArchiveRow,
} from '@daclify/modules/archive';

// Recover only the small reader grant here; the tally worker verifies all encrypted votes once.
export function archivedQuickGrants(detailValue: unknown, archivesValue: unknown) {
  const detail = QuickBallotResultInputSchema.parse(detailValue),
    archives = z.array(QuickBallotArchiveSchema).max(2).parse(archivesValue);
  const candidates = archives.filter(
    (value) => value.bundle.manifest.families[0]?.kind === 'quick-ballot-grants',
  );
  if (candidates.length !== 1) throw Error('QUICK_ARCHIVE_REQUIRED');
  const entry = candidates[0];
  if (!entry) throw Error('QUICK_ARCHIVE_REQUIRED');
  const bundle = verifyAnchoredArchive(entry.bundle, entry.anchor),
    { manifest } = bundle,
    family = manifest.families[0],
    chunk = family?.chunks[0];
  if (
    entry.anchor.revoked ||
    manifest.dao.chainId !== detail.chainId ||
    manifest.dao.contract !== detail.runtime ||
    manifest.dao.daoId !== detail.ballot.dao_id ||
    manifest.source.account !== detail.source ||
    manifest.families.length !== 1 ||
    manifest.files.length ||
    family?.parentId !== detail.ballot.id ||
    family.records !== '1' ||
    family.chunks.length !== 1 ||
    !chunk
  )
    throw Error('QUICK_ARCHIVE_DOMAIN');
  const asset = bundle.chunks.find((value) => value.cid === chunk.cid);
  if (!asset) throw Error('QUICK_ARCHIVE_REQUIRED');
  const rows = verifyArchiveChunkDescriptor(
      chunk,
      Uint8Array.from(atob(asset.content), (value) => value.charCodeAt(0)),
    ),
    row = rows[0];
  if (rows.length !== 1 || !row) throw Error('QUICK_ARCHIVE_DOMAIN');
  const decoded = decodeReleasedArchiveRow(chunk.domain, row, detail.ballot.id);
  if (decoded.kind !== 'quick-ballot-grants') throw Error('QUICK_ARCHIVE_DOMAIN');
  const grants = QuickBallotTableSchemas.qgrants.parse(decoded.value);
  if (
    grants.id !== detail.ballot.id ||
    grants.dao_id !== detail.ballot.dao_id ||
    grants.grants.length !== detail.ballot.definition.readers.length
  )
    throw Error('QUICK_ARCHIVE_DOMAIN');
  return grants;
}
