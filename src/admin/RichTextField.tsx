/**
 * RichTextField — TipTap WYSIWYG editor for `richtext` / `richtextList`
 * fields (wired in fields.tsx; lazily loaded so TipTap stays out of the
 * main bundle and only loads when a rich-text field is on screen).
 *
 * ALLOWLIST CONTRACT — server/src/modules/cms/registry.ts SANITIZE_OPTIONS
 * is the source of truth and the server re-sanitises every save. This
 * editor is configured to never PRODUCE anything outside that allowlist:
 *
 *   sanitize-html allowlist        →  editor equivalent
 *   ------------------------------    --------------------------------------
 *   p                              →  Paragraph (StarterKit)
 *   br                             →  HardBreak (Shift+Enter)
 *   strong, b                      →  Bold (emits <strong>, parses <b>)
 *   em, i                          →  Italic (emits <em>, parses <i>)
 *   u                              →  Underline
 *   s                              →  Strike (emits <s>)
 *   a[href, title, target, rel]    →  Link (toolbar sets href only and
 *                                     suppresses target/rel; title, target
 *                                     and rel round-trip if already in the
 *                                     HTML, or can be set in source mode)
 *   ul / ol / li                   →  BulletList / OrderedList / ListItem
 *   blockquote                     →  Blockquote
 *   h2, h3, h4                     →  Heading, levels [2, 3, 4] only
 *   sub / sup                      →  Subscript / Superscript
 *   span[class]                    →  NO toolbar control — HTML source mode
 *   schemes http/https/mailto/tel  →  Link isAllowedUri mirrors this list
 *                                     (plus relative paths and anchors;
 *                                     protocol-relative URLs are refused)
 *
 * StarterKit features that could emit non-allowlisted markup (inline
 * code, code blocks, horizontal rules) are disabled. No table or
 * text-style extensions are loaded, so pasted spans, inline styles,
 * tables and scripts are stripped by the schema parser on the way
 * in — paste cleanup is structural, not a post-processing pass.
 *
 * IMAGES (policies only): when the parent passes `mediaPick`, the
 * Image extension is loaded and a toolbar button inserts an image
 * chosen from the media library. That is for the legal policy pages,
 * whose OWN sanitizer (server/src/modules/policies/sanitize.ts)
 * allows img with media-library sources only. CMS fields never pass
 * mediaPick, so their contract above is unchanged: no Image node,
 * pasted images stripped on the way in.
 *
 * The value contract is unchanged: an HTML string in the section config
 * ("" means empty). The public renderer injects these fields as raw
 * HTML, exactly as it did when they were edited in a plain textarea.
 */
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {
  Bold,
  Code2,
  Eraser,
  Eye,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { cx, inputCls } from "./ui";

/** Schemes the server sanitizer keeps (registry.ts allowedSchemes). */
function isAllowedRichTextUri(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(https?|mailto|tel):/i.test(trimmed)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false; // any other scheme
  if (trimmed.startsWith("//")) return false; // protocol-relative: refused
  return true; // relative path, anchor or query
}

const PROSE_CLS =
  "min-h-[4.5rem] px-3 py-2 font-sans text-sm leading-relaxed text-foreground outline-none " +
  "[&_p]:mb-2 [&_p:last-of-type]:mb-0 " +
  "[&_h2]:mb-1.5 [&_h2:mt-3 [&_h2:text-xl [&_h2:font-medium [&_h2:leading-snug " +
  "[&_h3]:mb-1 [&_h3:mt-3 [&_h3:text-lg [&_h3:font-medium [&_h3:leading-snug " +
  "[&_h4]:mb-1 [&_h4:mt-2 [&_h4:text-base [&_h4:font-medium " +
  "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mb-0.5 [&_li>p]:mb-0 " +
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground " +
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-sm";

function countWords(editor: Editor): { words: number; chars: number } {
  const text = editor.getText();
  const trimmed = text.trim();
  return {
    words: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
    chars: text.length,
  };
}

export default function RichTextField({
  value,
  onChange,
  ariaLabel,
  mediaPick,
}: {
  value: string;
  onChange: (html: string) => void;
  ariaLabel?: string;
  /**
   * Optional media-library image picker (policy pages). When given,
   * an "Insert image" toolbar button appears; it must resolve with
   * the picked image URL + alt text, or null when cancelled.
   */
  mediaPick?: () => Promise<{ url: string; alt: string } | null>;
}) {
  const lastEmitted = useRef<string | null>(null);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [, setTick] = useState(0);
  /** null = visual mode; a string = HTML source mode holding that text. */
  const [source, setSource] = useState<string | null>(null);
  /** null = link bar closed; otherwise the URL being edited. */
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        // Replaced by the explicitly configured instances below.
        link: false,
        underline: false,
        // Not in the sanitize allowlist — must never be emitted.
        code: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ["http", "https", "mailto", "tel"],
        isAllowedUri: (url) => isAllowedRichTextUri(url),
        // href only in stored HTML: target/rel stay unset unless they
        // were already in the source HTML (both are allowlisted there).
        HTMLAttributes: { target: null, rel: null, class: null },
      }),
      Underline,
      Subscript,
      Superscript,
      // Only for consumers whose sanitizer allows media images
      // (policies). allowBase64 stays false: sources are URLs.
      ...(mediaPick ? [Image.configure({ inline: false, allowBase64: false })] : []),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: PROSE_CLS, "aria-label": ariaLabel ?? "Rich text" },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      lastEmitted.current = html;
      onChange(html);
      setStats(countWords(ed));
    },
    onSelectionUpdate: () => setTick((t) => t + 1),
  });

  // Keep the stats footer truthful from first render.
  useEffect(() => {
    if (editor) setStats(countWords(editor));
  }, [editor]);

  // External value changes (page-level undo/redo, section reload) flow
  // in; our own edits echo back identical HTML and are skipped. Source
  // mode owns the value while it is open, so it is exempt.
  useEffect(() => {
    if (!editor || source !== null) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current && value !== lastEmitted.current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
      setStats(countWords(editor));
    }
  }, [value, editor, source]);

  if (!editor) return null;

  const openSource = () => {
    setLinkUrl(null);
    setSource(editor.isEmpty ? "" : editor.getHTML());
  };

  const closeSource = () => {
    if (source === null) return;
    editor.commands.setContent(source || "", { emitUpdate: false });
    const html = editor.isEmpty ? "" : editor.getHTML();
    lastEmitted.current = html;
    onChange(html);
    setStats(countWords(editor));
    setSource(null);
  };

  const openLinkBar = () => {
    const href = editor.getAttributes("link").href;
    setLinkError(false);
    setLinkUrl(typeof href === "string" ? href : "");
  };

  const applyLink = () => {
    if (linkUrl === null) return;
    const url = linkUrl.trim();
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkUrl(null);
      return;
    }
    if (!isAllowedRichTextUri(url)) {
      setLinkError(true);
      return;
    }
    const ok = editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    if (!ok) {
      setLinkError(true);
      return;
    }
    setLinkUrl(null);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkUrl(null);
  };

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-input-background focus-within:ring-2 focus-within:ring-ring">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-secondary/50 px-1.5 py-1">
        {source === null ? (
          <>
            <ToolBtn label="Paragraph" onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive("paragraph")}>
              <Pilcrow size={14} />
            </ToolBtn>
            <ToolBtn label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
              <Heading2 size={14} />
            </ToolBtn>
            <ToolBtn label="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
              <Heading3 size={14} />
            </ToolBtn>
            <ToolBtn label="Heading 4" onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} active={editor.isActive("heading", { level: 4 })}>
              <Heading4 size={14} />
            </ToolBtn>
            <ToolSep />
            <ToolBtn label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
              <Bold size={14} />
            </ToolBtn>
            <ToolBtn label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
              <Italic size={14} />
            </ToolBtn>
            <ToolBtn label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}>
              <UnderlineIcon size={14} />
            </ToolBtn>
            <ToolBtn label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
              <Strikethrough size={14} />
            </ToolBtn>
            <ToolBtn label="Subscript" onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive("subscript")}>
              <SubscriptIcon size={14} />
            </ToolBtn>
            <ToolBtn label="Superscript" onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive("superscript")}>
              <SuperscriptIcon size={14} />
            </ToolBtn>
            <ToolSep />
            <ToolBtn label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
              <List size={14} />
            </ToolBtn>
            <ToolBtn label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
              <ListOrdered size={14} />
            </ToolBtn>
            <ToolBtn label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
              <Quote size={14} />
            </ToolBtn>
            <ToolSep />
            <ToolBtn label="Add or edit link" onClick={openLinkBar} active={editor.isActive("link")}>
              <Link2 size={14} />
            </ToolBtn>
            <ToolBtn
              label="Remove link"
              onClick={removeLink}
              disabled={!editor.isActive("link")}
            >
              <Link2Off size={14} />
            </ToolBtn>
            {mediaPick ? (
              <ToolBtn
                label="Insert image from media library"
                onClick={async () => {
                  const picked = await mediaPick();
                  if (picked) {
                    editor.chain().focus().setImage({ src: picked.url, alt: picked.alt }).run();
                  }
                }}
              >
                <ImageIcon size={14} />
              </ToolBtn>
            ) : null}
            <ToolBtn
              label="Clear formatting"
              onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            >
              <Eraser size={14} />
            </ToolBtn>
            <ToolSep />
            <ToolBtn label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
              <Undo2 size={14} />
            </ToolBtn>
            <ToolBtn label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
              <Redo2 size={14} />
            </ToolBtn>
          </>
        ) : (
          <span className="px-1 py-0.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
            HTML source — sanitised on save
          </span>
        )}
        <span className="flex-1" />
        <ToolBtn
          label={source === null ? "Edit HTML source" : "Back to visual editor"}
          onClick={source === null ? openSource : closeSource}
          active={source !== null}
        >
          {source === null ? <Code2 size={14} /> : <Eye size={14} />}
        </ToolBtn>
      </div>

      {/* Link bar */}
      {source === null && linkUrl !== null && (
        <div className="border-b border-border bg-secondary/30 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <input
              className={cx(inputCls, "h-8 flex-1 py-1 text-xs")}
              type="text"
              value={linkUrl}
              placeholder="https://…, /page-path, #anchor, mailto:… or tel:…"
              aria-label="Link URL"
              autoFocus
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setLinkError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === "Escape") setLinkUrl(null);
              }}
            />
            <button
              type="button"
              className="h-8 rounded-sm bg-accent px-2.5 text-xs font-medium text-accent-foreground hover:opacity-90"
              onClick={applyLink}
            >
              Apply
            </button>
            <button
              type="button"
              className="h-8 rounded-sm px-2 text-xs text-muted-foreground hover:bg-secondary"
              onClick={() => setLinkUrl(null)}
            >
              Cancel
            </button>
          </div>
          {linkError && (
            <p className="pt-1 text-xs text-destructive">
              That link type isn't allowed — use an http(s) address, a site path, an anchor, mailto: or tel:.
            </p>
          )}
        </div>
      )}

      {/* Editing surface */}
      {source !== null ? (
        <textarea
          className="block min-h-[7rem] w-full bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
          value={source}
          rows={8}
          aria-label={ariaLabel ?? "Rich text HTML source"}
          onChange={(e) => {
            setSource(e.target.value);
            onChange(e.target.value);
          }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-2 py-1 text-[0.65rem] text-muted-foreground">
        <span>
          {source !== null
            ? `${source.length} characters of HTML`
            : `${stats.words} word${stats.words === 1 ? "" : "s"} · ${stats.chars} characters`}
        </span>
        <span>Formatting is limited to what the site can display; it is sanitised on save.</span>
      </div>
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor selection alive: don't let the button take focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        "rounded-sm p-1.5 transition-colors disabled:pointer-events-none disabled:opacity-30",
        active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function ToolSep() {
  return <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />;
}
