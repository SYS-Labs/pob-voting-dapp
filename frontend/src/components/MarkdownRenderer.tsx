import { markdownToHtml } from '~/utils';

interface MarkdownRendererProps {
  content?: string | null;
}

const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
  if (!content) return null;
  return <div className="pob-markdown" dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }} />;
};

export default MarkdownRenderer;
