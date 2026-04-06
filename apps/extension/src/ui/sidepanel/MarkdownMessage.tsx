import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Mermaid } from "mermaid";
import "katex/dist/katex.min.css";
import "./markdown-message.css";

interface MarkdownMessageProps {
  content: string;
}

let mermaidLoader: Promise<Mermaid> | null = null;

function getMermaid(): Promise<Mermaid> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default"
      });
      return mermaid;
    });
  }

  return mermaidLoader;
}

function MermaidBlock({ code }: { code: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    void (async () => {
      try {
        const mermaid = await getMermaid();
        await mermaid.parse(code, { suppressErrors: false });
        const id = `surf-mermaid-${crypto.randomUUID()}`;
        const rendered = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(rendered.svg);
        }
      } catch (renderError) {
        if (!cancelled) {
          const message = renderError instanceof Error ? renderError.message : "Mermaid render failed";
          setError(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="surf-md-mermaid-fallback">
        <div className="surf-md-mermaid-error">Mermaid render failed: {error}</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="surf-md-mermaid-loading">
        Rendering Mermaid diagram...
      </div>
    );
  }

  return (
    <div
      className="surf-md-mermaid"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener nofollow"
        {...props}
      >
        {children}
      </a>
    );
  },
  pre({ children }) {
    return <div className="surf-md-pre">{children}</div>;
  },
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/i.exec(className ?? "")?.[1]?.toLowerCase();
    const code = String(children).replace(/\n$/, "");

    if (language === "mermaid") {
      return <MermaidBlock code={code} />;
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
};

export function MarkdownMessage({ content }: MarkdownMessageProps): JSX.Element {
  return (
    <div className="surf-md">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
