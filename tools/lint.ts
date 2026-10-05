import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export type LintRule =
  'explicit-any' | 'ts-suppression' | 'non-null-assertion' | 'unchecked-unknown-cast';

export interface LintViolation {
  file: string;
  line: number;
  rule: LintRule;
}

const skipped = new Set(['node_modules', 'dist', '.artifacts', 'generated', 'coverage']);

function report(
  file: string,
  source: string,
  position: number,
  rule: LintRule,
  out: LintViolation[],
) {
  out.push({ file, line: source.slice(0, position).split('\n').length, rule });
}

function scripts(fileName: string, source: string): string[] {
  if (!fileName.endsWith('.vue')) return [source];
  const found: string[] = [];
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1] ?? '';
    if (attrs.includes('lang=') && !/lang=["']ts["']/.test(attrs)) continue;
    found.push(match[2] ?? '');
  }
  return found;
}

export function scanSource(fileName: string, source: string): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const script of scripts(fileName, source)) {
    const parsed = ts.createSourceFile(
      fileName,
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        report(fileName, script, node.getStart(parsed), 'explicit-any', violations);
      if (ts.isNonNullExpression(node))
        report(fileName, script, node.getStart(parsed), 'non-null-assertion', violations);
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        node.type.kind === ts.SyntaxKind.UnknownKeyword
      )
        report(fileName, script, node.getStart(parsed), 'unchecked-unknown-cast', violations);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    const text = parsed.getFullText();
    const comments: Array<{ pos: number; end: number }> = [];
    const collect = (node: ts.Node) => {
      for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [])
        comments.push(range);
      for (const range of ts.getTrailingCommentRanges(text, node.getEnd()) ?? [])
        comments.push(range);
      ts.forEachChild(node, collect);
    };
    collect(parsed);
    for (const match of text.matchAll(/@ts-(?:ignore|expect-error|nocheck)/g)) {
      const position = match.index ?? 0;
      if (comments.some((range) => range.pos <= position && position < range.end))
        report(fileName, script, position, 'ts-suppression', violations);
    }
  }
  return violations;
}

export function scanTree(root: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skipped.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue'))
        violations.push(...scanSource(path.relative(root, full), readFileSync(full, 'utf8')));
    }
  };
  walk(root);
  return violations;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const violations = scanTree(process.cwd());
  for (const violation of violations)
    console.error(`${violation.file}:${violation.line} ${violation.rule}`);
  if (violations.length > 0) process.exit(1);
}
