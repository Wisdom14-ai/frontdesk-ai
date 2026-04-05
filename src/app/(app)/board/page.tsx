import { Board } from "@/components/kanban/Board";
import { ChatSheet } from "@/components/chat/ChatSheet";

export default function BoardPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 pt-6 pb-4 shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Pipeline</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Drag and drop leads to update their status
        </p>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <Board />
      </div>
      <ChatSheet />
    </div>
  );
}
