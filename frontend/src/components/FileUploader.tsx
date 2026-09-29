import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, isAcceptedFile, parseRecipientFile } from '../utils/recipients';
import type { ParsedRecipients } from '../utils/recipients';

export interface FileParseResult extends ParsedRecipients {
  fileName: string;
  fileSize: number;
}

export function FileUploader({
  onParsed,
  onClear,
}: {
  onParsed: (result: FileParseResult) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    if (!isAcceptedFile(file.name)) {
      setError(`Only ${ACCEPTED_EXTENSIONS.join(', ')} files are supported.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('File is too large (max 2 MB).');
      return;
    }
    const text = await file.text();
    const parsed = parseRecipientFile(file.name, text);
    if (parsed.valid.length === 0) {
      setError('No valid email addresses found in this file.');
      return;
    }
    setFileName(file.name);
    onParsed({ ...parsed, fileName: file.name, fileSize: file.size });
  }

  function clear() {
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
    onClear();
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload recipient file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
          dragging ? 'border-slate-500 bg-slate-100' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
        }`}
      >
        <p className="text-sm font-medium text-slate-700">Drag & drop a .csv or .txt file here</p>
        <p className="mt-1 text-xs text-slate-500">
          or <span className="underline">browse</span> · max 2 MB
        </p>
        {fileName ? (
          <p className="mt-2 text-xs font-medium text-slate-700">Selected: {fileName}</p>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
      {fileName ? (
        <button onClick={clear} className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">
          Remove file
        </button>
      ) : null}
    </div>
  );
}
