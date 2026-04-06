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
    mermaidLoader = import("mermaid").then((module) => module.default);
  }

  return mermaidLoader;
}

function MermaidBlock({ code, theme }: { code: string; theme: "default" | "dark" }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    void (async () => {
      try {
        const mermaid = await getMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme
        });
        await mermaid.parse(code, { suppressErrors: false });
        const id = `surf-mermaid-${theme}-${crypto.randomUUID()}`;
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
  }, [code, theme]);

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
      const isDark = document.documentElement.classList.contains("dark");
      return <MermaidBlock code={code} theme={isDark ? "dark" : "default"} />;
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
};

export function MarkdownMessage({ content }: MarkdownMessageProps): JSX.Element {
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeVersion((previous) => previous + 1);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="surf-md" key={themeVersion}>
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
