import { describe, expect, it } from 'vitest';
import { formatHelpAnswer } from '../../src/help/format';

describe('formatted help answers', () => {
  it('renders prose, emphasis, lists and code while keeping code escaped', () => {
    const html = formatHelpAnswer(
      '**Telos Zero** and *EVM*.\n\n- One\n- Two\n\n```txt\n<img src=x>\n```',
    );
    expect(html).toContain('<strong>Telos Zero</strong>');
    expect(html).toContain('<em>EVM</em>');
    expect(html).toContain('<ul>\n<li>One</li>\n<li>Two</li>\n</ul>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'jav&#x61;script:alert(1)',
    'data:text/html,evil',
    'vbscript:evil',
    'file:///etc/passwd',
    'http://docs.telos.net/',
  ])('does not turn %s into a clickable link', (href) => {
    expect(formatHelpAnswer(`[Unsafe](${href})`)).not.toContain('<a ');
  });

  it('never includes credentials in a link destination', () => {
    const html = formatHelpAnswer('[Unsafe](https://user:password@docs.telos.net/private)');
    expect(html).not.toMatch(/href="[^"]*@/);
  });

  it('escapes raw HTML and suppresses images rather than loading model-supplied resources', () => {
    const html = formatHelpAnswer(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![<img src=x>](https://tracker.example/pixel)',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<(?:script|img|iframe)\b/);
    expect(html).not.toContain('src="');
  });

  it('links HTTPS sources with isolated new tabs and escapes link attributes', () => {
    const html = formatHelpAnswer(
      '[Guide](https://docs.telos.net/zero/?a=1&b=2 "Quoted & title")\n\n<https://docs.telos.net/>',
    );
    expect(html).toContain('href="https://docs.telos.net/zero/?a=1&amp;b=2"');
    expect(html).toContain('title="Quoted &amp; title"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  });
});
