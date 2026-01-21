import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteTask, getAllTasks, updateTask, type Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import { Search } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';

export function LibraryPage() {
  return (
    <SidebarProvider>
      <LibraryContent />
    </SidebarProvider>
  );
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays === 1) {
    return '1 day ago';
  } else {
    return `${diffDays} days ago`;
  }
}

function LibraryContent() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  // Load tasks
  useEffect(() => {
    async function loadTasks() {
      setIsLoading(true);
      try {
        const allTasks = await getAllTasks();
        setTasks(allTasks);
      } catch (error) {
        console.error('Failed to load tasks:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadTasks();
  }, []);

  // Filter tasks by search query
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const query = searchQuery.toLowerCase();
    return tasks.filter((task) => task.prompt.toLowerCase().includes(query));
  }, [tasks, searchQuery]);

  const handleTaskClick = (taskId: string) => {
    if (selectMode) {
      setSelectedTasks((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
        return newSet;
      });
    } else {
      navigate(`/task/${taskId}`);
    }
  };

  const handleSelectToggle = () => {
    if (selectMode) {
      setSelectMode(false);
      setSelectedTasks(new Set());
    } else {
      setSelectMode(true);
    }
  };

  // Handle task deletion
  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  // Handle favorite toggle
  const handleToggleFavorite = async (taskId: string, favorite: boolean) => {
    try {
      await updateTask(taskId, { favorite });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, favorite } : t))
      );
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* Main Content */}
      <main className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm">
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            {/* Search Box */}
            <div className="relative mb-6">
              <Search className="text-muted-foreground absolute top-1/2 left-4 size-5 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your chats..."
                className="border-primary/30 bg-background text-foreground placeholder:text-muted-foreground focus:border-primary h-14 w-full rounded-xl border-2 pr-4 pl-12 text-lg transition-colors focus:outline-none"
              />
            </div>

            {/* Count & Select */}
            <div className="mb-2 flex items-center gap-3 px-1">
              <span className="text-muted-foreground text-sm">
                {filteredTasks.length} chat
                {filteredTasks.length !== 1 ? 's' : ''} with Claude
              </span>
              <button
                onClick={handleSelectToggle}
                className="text-primary cursor-pointer text-sm font-medium hover:underline"
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            </div>

            {/* Tasks List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-muted-foreground flex items-center gap-3">
                  <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>Loading...</span>
                </div>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <h3 className="text-foreground mb-2 text-lg font-medium">
                  {searchQuery ? 'No chats found' : 'No chats yet'}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {searchQuery
                    ? 'Try adjusting your search query'
                    : 'Start a new task to begin chatting'}
                </p>
              </div>
            ) : (
              <div className="border-border border-t">
                {filteredTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => handleTaskClick(task.id)}
                    className={cn(
                      'border-border hover:bg-accent/30 flex w-full cursor-pointer items-start gap-3 border-b px-1 py-5 text-left transition-colors',
                      selectMode && selectedTasks.has(task.id) && 'bg-accent/50'
                    )}
                  >
                    {selectMode && (
                      <div
                        className={cn(
                          'mt-1 flex size-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                          selectedTasks.has(task.id)
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground/50'
                        )}
                      >
                        {selectedTasks.has(task.id) && (
                          <svg
                            className="text-primary-foreground size-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="text-foreground truncate text-base font-medium">
                        {task.prompt || 'Untitled'}
                      </h3>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        Last message{' '}
                        {formatRelativeTime(task.updated_at || task.created_at)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
