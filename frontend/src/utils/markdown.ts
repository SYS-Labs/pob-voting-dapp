export function markdownToHtml(markdown: string): string {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const escapeHtml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const renderInline = (text: string) => {
    let result = escapeHtml(text);
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/`(.+?)`/g, '<code>$1</code>');
    result = result.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return result;
  };

  return blocks
    .map((block) => {
      const headingMatch = block.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        return `<h${level}>${renderInline(text)}</h${level}>`;
      }

      const unorderedListMatch = block.match(/^[-*]\s/);
      if (unorderedListMatch) {
        const items = block
          .split('\n')
          .filter((line) => /^[-*]\s/.test(line))
          .map((line) => `<li>${renderInline(line.replace(/^[-*]\s/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      const orderedListMatch = block.match(/^\d+\.\s/);
      if (orderedListMatch) {
        const items = block
          .split('\n')
          .filter((line) => /^\d+\.\s/.test(line))
          .map((line) => `<li>${renderInline(line.replace(/^\d+\.\s/, ''))}</li>`)
          .join('');
        return `<ol>${items}</ol>`;
      }

      return `<p>${renderInline(block)}</p>`;
    })
    .join('');
}

export function getYouTubeEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const id = parsed.pathname.replace('/', '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/embed/')) {
        return parsed.href;
      }
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
  } catch (error) {
    console.warn('[getYouTubeEmbedUrl] Invalid URL provided:', url, error);
  }
  return null;
}
