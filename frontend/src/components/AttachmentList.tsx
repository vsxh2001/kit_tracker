import { useRef } from "react";
import { Paperclip, FileText, Image, FileVideo, FileArchive, Trash2 } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { attachmentUrl } from "../services/kits";
import type { Kit } from "../types";

interface Props {
  kit: Kit;
  onUpload?: (file: File) => Promise<void>;
  onDelete?: (filename: string) => Promise<void>;
  canEdit: boolean;
}

function fileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return Image;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return FileVideo;
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return FileArchive;
  if (["pdf", "doc", "docx", "txt", "csv", "xls", "xlsx"].includes(ext)) return FileText;
  return Paperclip;
}

export function AttachmentList({ kit, onUpload, onDelete, canEdit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attachments = kit.attachments ?? [];

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    await onUpload(file);
    // Reset input so same file can be re-uploaded if needed
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            data-testid="attachment-file-input"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Upload file
          </button>
        </div>
      )}

      {attachments.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          heading="No attachments"
          body="No files attached to this kit yet."
          className="py-8"
        />
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((filename) => {
            const Icon = fileIcon(filename);
            const url = attachmentUrl(kit, filename);
            return (
              <li
                key={filename}
                className="flex items-center gap-2 px-3 py-2 rounded-md border bg-card hover:bg-slate-50/60 transition-colors"
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-700 hover:underline truncate flex-1"
                  data-testid={`attachment-link-${filename}`}
                >
                  {filename}
                </a>
                {canEdit && onDelete && (
                  <button
                    onClick={() => onDelete(filename)}
                    className="ml-auto shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label={`Delete ${filename}`}
                    data-testid={`attachment-delete-${filename}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
