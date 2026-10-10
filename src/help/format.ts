import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true });
markdown.validateLink = (href) => {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  if (!token) return '';
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index]?.content ?? '');

export function formatHelpAnswer(text: string): string {
  return markdown.render(text);
}
