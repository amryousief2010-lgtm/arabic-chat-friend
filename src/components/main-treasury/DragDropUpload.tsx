import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Upload, X, FileImage, FileText } from "lucide-react";

interface DragDropUploadProps {
  value: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  label?: string;
  requiredHint?: string;
  className?: string;
}

export default function DragDropUpload({
  value,
  onChange,
  accept = "image/jpeg,image/png,image/jpg,application/pdf",
  label = "اسحب الملف هنا أو انقر للاختيار",
  requiredHint,
  className,
}: DragDropUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files?.[0] || null;
      if (droppedFile) {
        // Validate accept types roughly
        const acceptedTypes = accept.split(",").map((t) => t.trim());
        const isAccepted = acceptedTypes.some((t) => {
          if (t.endsWith("/*")) return droppedFile.type.startsWith(t.replace("/*", ""));
          return droppedFile.type === t;
        });
        if (!isAccepted) {
          // Let the caller handle validation if needed; we still set it
          // but could also reject. For now we set and let forms validate.
        }
        onChange(droppedFile);
      }
    },
    [accept, onChange]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0] || null;
      onChange(selectedFile);
    },
    [onChange]
  );

  const clear = useCallback(() => {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onChange]);

  const fileIcon = (mime?: string) => {
    if (mime?.startsWith("image/")) return <FileImage className="w-5 h-5 text-primary" />;
    return <FileText className="w-5 h-5 text-primary" />;
  };

  return (
    <div className={cn("w-full", className)}>
      {!value ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "relative cursor-pointer rounded-lg border-2 border-dashed transition-colors duration-200 p-6 text-center",
            isDragging
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/30 bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={handleInputChange}
          />
          <Upload className={cn("mx-auto mb-2 h-8 w-8", isDragging ? "text-primary" : "text-muted-foreground")} />
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            JPG · PNG · PDF
          </p>
          {requiredHint && (
            <p className="text-xs text-destructive mt-1 font-medium">{requiredHint}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          {fileIcon(value.type)}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" title={value.name}>
              {value.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {Math.round(value.size / 1024)} KB · {value.type || "unknown"}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="إزالة الملف"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
