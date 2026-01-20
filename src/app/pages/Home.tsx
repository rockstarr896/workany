import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession, getAllTasks, type Task } from '@/shared/db';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowUp, FileText, Paperclip, Plus, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { LeftSidebar, SidebarProvider } from '@/components/layout';

// Attachment type for files and images
interface Attachment {
  id: string;
  file: File;
  type: 'image' | 'file';
  preview?: string;
}

export function HomePage() {
  return (
    <SidebarProvider>
      <HomeContent />
    </SidebarProvider>
  );
}

function HomeContent() {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate unique ID for attachments
  const generateId = () =>
    `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Check if file is an image
  const isImageFile = (file: File) => file.type.startsWith('image/');

  // Create preview for image files
  const createImagePreview = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
  };

  // Add files to attachments
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newAttachments: Attachment[] = [];

    for (const file of fileArray) {
      const isImage = isImageFile(file);
      const attachment: Attachment = {
        id: generateId(),
        file,
        type: isImage ? 'image' : 'file',
      };

      if (isImage) {
        attachment.preview = await createImagePreview(file);
      }

      newAttachments.push(attachment);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  // Remove attachment
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  // Handle paste event for image upload
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await addFiles(imageFiles);
      }
    },
    [addFiles]
  );

  // Open file picker
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Load tasks for sidebar
  useEffect(() => {
    async function loadTasks() {
      try {
        const allTasks = await getAllTasks();
        setTasks(allTasks);
      } catch (error) {
        console.error('Failed to load tasks:', error);
      }
    }
    loadTasks();
  }, []);

  const handleSubmit = async () => {
    if (value.trim() || attachments.length > 0) {
      const prompt = value.trim();

      // Create a new session
      const sessionId = generateSessionId(prompt);
      try {
        await createSession({ id: sessionId, prompt });
        console.log('[Home] Created new session:', sessionId);
      } catch (error) {
        console.error('[Home] Failed to create session:', error);
      }

      // Generate task ID and navigate
      const taskId = Date.now().toString();
      navigate(`/task/${taskId}`, {
        state: {
          prompt,
          sessionId,
          taskIndex: 1,
          attachments: attachments.map((a) => ({
            name: a.file.name,
            type: a.type,
            preview: a.preview,
          })),
        },
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar tasks={tasks} />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm">
        {/* Content Area - Vertically Centered */}
        <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4">
          <div className="flex w-full max-w-2xl flex-col items-center gap-6">
            {/* Title */}
            <h1 className="text-foreground text-center font-serif text-4xl font-normal tracking-tight md:text-5xl">
              {t.home.welcomeTitle}
            </h1>

            {/* Input Box */}
            <div className="bg-card border-border/80 focus-within:border-primary/30 w-full rounded-2xl border shadow-md transition-shadow duration-200 focus-within:shadow-lg hover:shadow-lg">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv,.xlsx,.xls,.pptx,.ppt"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Attachment Preview */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 p-3 pb-0">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="border-border/50 bg-muted/50 group relative flex items-center gap-2 rounded-lg border px-3 py-2"
                    >
                      {attachment.type === 'image' && attachment.preview ? (
                        <img
                          src={attachment.preview}
                          alt={attachment.file.name}
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="bg-muted flex h-10 w-10 items-center justify-center rounded">
                          <FileText className="text-muted-foreground h-5 w-5" />
                        </div>
                      )}
                      <span className="text-foreground max-w-[120px] truncate text-sm">
                        {attachment.file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        className="bg-foreground text-background absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Textarea */}
              <div className="p-4 pb-2">
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={t.home.inputPlaceholder}
                  className="text-foreground placeholder:text-muted-foreground min-h-[72px] w-full resize-none border-0 bg-transparent text-base focus:outline-none"
                  rows={2}
                />
              </div>

              {/* Bottom Actions */}
              <div className="flex items-center justify-between px-3 py-2.5">
                {/* Add Button with Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors duration-200 focus:outline-none">
                    <Plus className="size-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={8} className="w-56">
                    <DropdownMenuItem
                      onSelect={openFilePicker}
                      className="cursor-pointer gap-3 py-2.5"
                    >
                      <Paperclip className="size-4" />
                      <span>Add files or photos</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!value.trim() && attachments.length === 0}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-all duration-200',
                    value.trim() || attachments.length > 0
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-sm'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  <ArrowUp className="size-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
