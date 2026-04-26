import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const ChatMessage = ({ body, className }: { body: string; className?: string }) => (
  <div className={className}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="link link-primary break-all">
            {children}
          </a>
        ),
        // block-level elements that would break chat bubble layout — render inline
        p: ({ children }) => <span className="block">{children}</span>,
        h1: ({ children }) => <strong>{children}</strong>,
        h2: ({ children }) => <strong>{children}</strong>,
        h3: ({ children }) => <strong>{children}</strong>,
        // strip images — no remote content in chat
        img: () => null,
      }}
    >
      {body}
    </ReactMarkdown>
  </div>
);
