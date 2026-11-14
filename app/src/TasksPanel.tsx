import { useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { uid } from "./study";
export type ProjectTask = {
  id: string;
  title: string;
  done: boolean;
  note: string;
};
export default function TasksPanel() {
  const { study: s, update, showPanel } = useWorkspace();
  const [title, setTitle] = useState("");
  const tasks = s.tasks || [];
  const edit = (id: string, p: Partial<ProjectTask>) =>
    update({ tasks: tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const askAI = (prompt: string) => {
    localStorage.setItem(`luna-chat-prefill-${s.id}`, prompt);
    showPanel("chat");
    window.dispatchEvent(new CustomEvent("luna-chat-prefill", { detail: { studyId: s.id, prompt } }));
  };
  return (
    <div className="panel-scroll tasks-panel">
      <header className="tasks-heading"><div><h2>Tasks</h2><p className="hint">
        Track preparation, data checks and review separately from timed mission
        activities.
      </p></div><span>{tasks.filter((task) => task.done).length}/{tasks.length} complete</span></header>
      <div className="task-ai-actions">
        <button onClick={() => askAI("Review this lunar study and draft a concise, prioritized task checklist using the add_tasks action. Assess whether the current study location and region suit the selected science goals and available instruments, and review the geometry, mission timeline, and current assumptions. Explain what can be improved and why. Preserve uncertainty; do not claim landing clearance.")}>Draft study tasks with AI</button>
      </div>
      <form
        className="quick-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          update({ tasks: [...tasks, {
                id: uid(),
                title: title.trim().slice(0, 200),
                done: false,
                note: "",
              }] });
          setTitle("");
        }}
      >
        <input
          aria-label="New task"
          placeholder="What needs doing?"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="primary">Add task</button>
      </form>
      {tasks.length === 0 ? <div className="tasks-empty"><strong>No tasks yet</strong><span>Add one above or ask AI to draft study tasks.</span></div> : null}
      {tasks.map((t) => (
        <details className={`section task-card ${t.done ? "is-done" : ""}`} key={t.id}>
          <summary>
            <input
              type="checkbox"
              aria-label={`Complete task ${t.title}`}
              checked={t.done}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => edit(t.id, { done: e.target.checked })}
            />
            {t.title}
          </summary>
          <div className="section-content">
            <input
              aria-label="Task title"
              placeholder="Task title"
              value={t.title}
              maxLength={200}
              onChange={(e) => edit(t.id, { title: e.target.value })}
            />
            <textarea
              aria-label="Task notes"
              placeholder="Notes, next steps, or completion summary"
              value={t.note}
              maxLength={5000}
              onChange={(e) => edit(t.id, { note: e.target.value })}
            />
            <div className="task-actions">
            <button className="task-ai-button"
              onClick={() => askAI(`Work on this study task: "${t.title}". Existing task notes: ${t.note || "none"}. Review the current lunar study location, selected region, instruments/hardware assumptions, mission geometry, and timeline. Provide a practical plan or perform the relevant supported study analysis, summarize findings and concrete improvements, and update this task with a concise completion summary only if the work can be completed from available study data. Otherwise leave it open and explain the next needed input.`)}>
              Work on this task with AI
            </button>
            <button
              onClick={() =>
                update({ tasks: tasks.filter((x) => x.id !== t.id) })
              }
            >
              Remove task
            </button>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
